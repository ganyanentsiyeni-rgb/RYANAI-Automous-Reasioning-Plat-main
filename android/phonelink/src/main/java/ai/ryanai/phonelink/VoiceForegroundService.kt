package ai.ryanai.phonelink

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * User-started live RyanAI voice. The visible foreground-service notification
 * remains present while the microphone is active and provides an immediate stop action.
 */
class VoiceForegroundService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val playbackExecutor = Executors.newSingleThreadExecutor()
    private val client by lazy {
        OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    }
    private val running = AtomicBoolean(false)
    @Volatile private var socket: WebSocket? = null
    @Volatile private var recorder: AudioRecord? = null
    @Volatile private var player: AudioTrack? = null
    @Volatile private var captureThread: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (running.compareAndSet(false, true)) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                running.set(false)
                stopSelf()
                return START_NOT_STICKY
            }
            startVoiceForeground()
            executor.execute { connectVoiceSession() }
        }
        return START_NOT_STICKY
    }

    private fun startVoiceForeground() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "RyanAI Live Voice", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notification = buildNotification("Microphone active · RyanAI is connecting")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(message: String): Notification {
        val stopIntent = Intent(this, VoiceForegroundService::class.java).setAction(ACTION_STOP)
        val stopPendingIntent = PendingIntent.getService(
            this, 701, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("RyanAI Live Voice")
            .setContentText(message)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_media_pause, "Stop voice", stopPendingIntent)
            .build()
    }

    private fun updateNotification(message: String) {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(message))
    }

    private fun connectVoiceSession() {
        try {
            val token = SecureTokenStore(this).read()
                ?: throw IllegalStateException("PhoneLink device session is missing. Pair this phone again.")
            val ticketBody = JSONObject()
                .put("language", "en-ZA")
                .toString()
                .toRequestBody("application/json".toMediaType())
            val ticketRequest = Request.Builder()
                .url("${BuildConfig.RYANAI_BASE_URL}/api/phonelink/mobile/voice-ticket")
                .header("Authorization", "Bearer $token")
                .post(ticketBody)
                .build()
            client.newCall(ticketRequest).execute().use { response ->
                val payload = JSONObject(response.body?.string().orEmpty())
                if (!response.isSuccessful) {
                    throw IllegalStateException(payload.optString("error", "RyanAI did not authorize live voice."))
                }
                val ticket = payload.optString("ticket")
                if (ticket.isBlank()) throw IllegalStateException("RyanAI returned an invalid voice ticket.")
                val websocketUrl = BuildConfig.RYANAI_BASE_URL
                    .replaceFirst("https://", "wss://")
                    .replaceFirst("http://", "ws://") + "/api/v1/realtime/voice?ticket=" + ticket
                val request = Request.Builder().url(websocketUrl).build()
                socket = client.newWebSocket(request, voiceListener)
            }
        } catch (error: Exception) {
            updateNotification(error.message ?: "Could not connect to RyanAI voice.")
            stopSelf()
        }
    }

    private val voiceListener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            updateNotification("Connected · waiting for RyanAI voice session")
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            try {
                val event = JSONObject(text)
                when (event.optString("type")) {
                    "session.started" -> startAudioCapture()
                    "session.output_audio.delta" -> playAudio(event.optString("delta"))
                    "session.closed" -> stopSelf()
                    "error" -> {
                        updateNotification(event.optJSONObject("error")?.optString("message") ?: "RyanAI voice returned an error.")
                        stopSelf()
                    }
                }
            } catch (_: Exception) {
                updateNotification("RyanAI sent an unreadable voice event.")
                stopSelf()
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            updateNotification(t.message ?: "RyanAI voice connection failed.")
            stopSelf()
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            stopSelf()
        }
    }

    private fun startAudioCapture() {
        if (recorder != null || !running.get()) return
        try {
            val sampleRate = 24_000
            val minimum = AudioRecord.getMinBufferSize(
                sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
            )
            if (minimum <= 0) throw IllegalStateException("This Android device does not support the required 24 kHz microphone format.")
            val bufferBytes = maxOf(minimum, sampleRate / 10 * 2)
            val audioRecord = AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                sampleRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferBytes,
            )
            if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
                audioRecord.release()
                throw IllegalStateException("Android could not initialize the microphone.")
            }
            val outputMinimum = AudioTrack.getMinBufferSize(
                sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT
            )
            if (outputMinimum <= 0) throw IllegalStateException("This Android device does not support the required 24 kHz playback format.")
            val audioTrackBufferBytes = maxOf(outputMinimum, bufferBytes)
            val audioTrack = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setSampleRate(sampleRate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .build()
                )
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(audioTrackBufferBytes)
                .build()
            audioRecord.startRecording()
            audioTrack.play()
            recorder = audioRecord
            player = audioTrack
            updateNotification("Live · microphone active · tap Stop to end")
            captureThread = Thread({
                // 1024 samples at 24 kHz stays below the server's 1,800-event/minute limit.
                val samples = ShortArray(1024)
                while (running.get() && audioRecord.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                    val count = audioRecord.read(samples, 0, samples.size)
                    if (count <= 0) continue
                    val pcm = ByteBuffer.allocate(count * 2).order(ByteOrder.LITTLE_ENDIAN)
                    for (index in 0 until count) pcm.putShort(samples[index])
                    val encoded = Base64.encodeToString(pcm.array(), Base64.NO_WRAP)
                    val sent = socket?.send(
                        JSONObject().put("type", "session.input_audio.append").put("audio", encoded).toString()
                    ) ?: false
                    if (!sent) break
                }
            }, "RyanAI-Voice-Microphone").apply { start() }
        } catch (error: Exception) {
            updateNotification(error.message ?: "Could not start Android microphone capture.")
            stopSelf()
        }
    }

    private fun playAudio(encoded: String) {
        if (encoded.isBlank()) return
        val pcm = runCatching { Base64.decode(encoded, Base64.DEFAULT) }.getOrNull() ?: return
        if (pcm.isEmpty() || pcm.size % 2 != 0) return
        playbackExecutor.execute {
            val audioTrack = player ?: return@execute
            if (!running.get()) return@execute
            val written = runCatching { audioTrack.write(pcm, 0, pcm.size, AudioTrack.WRITE_BLOCKING) }.getOrDefault(-1)
            if (written < 0) {
                updateNotification("RyanAI audio playback failed.")
                stopSelf()
            }
        }
    }

    override fun onDestroy() {
        running.set(false)
        socket?.close(1000, "User stopped RyanAI voice")
        socket = null
        captureThread?.interrupt()
        captureThread = null
        runCatching { recorder?.stop() }
        recorder?.release()
        recorder = null
        runCatching { player?.stop() }
        player?.release()
        player = null
        executor.shutdownNow()
        playbackExecutor.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_ID = "ryanai_live_voice"
        private const val NOTIFICATION_ID = 7042
        private const val ACTION_START = "ai.ryanai.phonelink.action.START_VOICE"
        private const val ACTION_STOP = "ai.ryanai.phonelink.action.STOP_VOICE"

        fun start(context: android.content.Context) {
            val intent = Intent(context, VoiceForegroundService::class.java).setAction(ACTION_START)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: android.content.Context) {
            context.startService(Intent(context, VoiceForegroundService::class.java).setAction(ACTION_STOP))
        }
    }
}
