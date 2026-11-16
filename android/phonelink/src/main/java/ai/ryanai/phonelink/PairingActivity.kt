package ai.ryanai.phonelink

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class PairingActivity : AppCompatActivity() {
    private lateinit var statusView: TextView
    private lateinit var eventsLayout: LinearLayout
    private val executor = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private val store by lazy { SecureTokenStore(this) }

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        statusView.text = if (granted) "PhoneLink notifications enabled." else "Notifications are off. Updates remain available in the PhoneLink inbox."
    }

    private val microphonePermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) startVoiceSession() else statusView.text = "Microphone permission is required to start RyanAI live voice."
    }

    private val pollTask = object : Runnable {
        override fun run() {
            if (!isFinishing && store.read() != null) {
                refreshEvents()
                handler.postDelayed(this, 30_000)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildScreen()
        handleIntent(intent)
        if (store.read() != null) {
            statusView.text = "PhoneLink is connected. Loading your mobile inbox…"
            scheduleBackgroundSync()
            requestNotificationsIfNeeded()
            refreshEvents()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun buildScreen() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(24, 28, 24, 24)
            setBackgroundColor(android.graphics.Color.rgb(7, 17, 31))
        }
        val title = TextView(this).apply {
            text = "RyanAI PhoneLink"
            textSize = 25f
            setTextColor(android.graphics.Color.WHITE)
            gravity = Gravity.CENTER
        }
        statusView = TextView(this).apply {
            text = "Connect your phone to RyanAI."
            textSize = 14f
            setTextColor(android.graphics.Color.LTGRAY)
            gravity = Gravity.CENTER
            setPadding(8, 16, 8, 16)
        }
        val refresh = Button(this).apply {
            text = "Refresh inbox"
            setOnClickListener { refreshEvents() }
        }
        val startVoice = Button(this).apply {
            text = "Start RyanAI live voice"
            setOnClickListener { requestVoicePermissionAndStart() }
        }
        val stopVoice = Button(this).apply {
            text = "Stop live voice"
            setOnClickListener { VoiceForegroundService.stop(this@PairingActivity); statusView.text = "RyanAI live voice stop requested." }
        }
        val voicePrivacy = TextView(this).apply {
            text = "Live voice requires the separately granted voice.live PhoneLink capability and Android microphone permission. Starting is always user-initiated; the ongoing notification provides Stop."
            textSize = 12f
            setTextColor(android.graphics.Color.LTGRAY)
            setPadding(4, 8, 4, 8)
        }
        eventsLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 12, 0, 12)
        }
        val scroll = ScrollView(this).apply { addView(eventsLayout) }
        root.addView(title, LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        root.addView(statusView, LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        root.addView(refresh, LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        root.addView(startVoice, LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        root.addView(stopVoice, LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        root.addView(voicePrivacy, LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
    }

    private fun requestVoicePermissionAndStart() {
        if (store.read() == null) {
            statusView.text = "Pair this phone with RyanAI before starting live voice."
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
            return
        }
        startVoiceSession()
    }

    private fun startVoiceSession() {
        if (store.read() == null) {
            statusView.text = "Pair this phone with RyanAI before starting live voice."
            return
        }
        VoiceForegroundService.start(this)
        statusView.text = "RyanAI live voice is starting. Keep the ongoing notification visible to control the microphone session."
    }

    private fun handleIntent(source: Intent?) {
        val uri = source?.data ?: return
        if (uri.scheme != "ryanai-phonelink" || uri.host != "pair") {
            statusView.text = "This is not a valid RyanAI PhoneLink link."
            return
        }
        val code = uri.getQueryParameter("code")
        if (code.isNullOrBlank() || code.length !in 30..50) {
            statusView.text = "The one-time pairing exchange code is missing or invalid."
            return
        }
        exchangeCode(code)
    }

    private fun exchangeCode(code: String) {
        statusView.text = "Securing this phone with RyanAI…"
        executor.execute {
            try {
                val connection = (URL("${BuildConfig.RYANAI_BASE_URL}/api/phonelink/device-sessions/exchange").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 10_000
                    readTimeout = 10_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
                connection.outputStream.use { it.write(JSONObject().put("exchangeCode", code).toString().toByteArray()) }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val response = JSONObject(stream.bufferedReader().use { it.readText() })
                if (status !in 200..299) throw IllegalStateException(response.optString("error", "Pairing exchange failed."))
                val token = response.getString("deviceToken")
                store.save(token)
                runOnUiThread {
                    statusView.text = "Phone securely paired. Your RyanAI mobile inbox is ready."
                    scheduleBackgroundSync()
                    requestNotificationsIfNeeded()
                    refreshEvents()
                }
            } catch (error: Exception) {
                runOnUiThread { statusView.text = error.message ?: "Could not finish secure PhoneLink pairing. Return to RyanAI and generate a new QR code." }
            }
        }
    }

    private fun scheduleBackgroundSync() {
        val request = PeriodicWorkRequestBuilder<PhoneLinkSyncWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "ryanai-phonelink-inbox",
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    private fun requestNotificationsIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun refreshEvents() {
        val token = store.read() ?: run {
            statusView.text = "This phone is not paired. Open PhoneLink in RyanAI and scan a new QR code."
            return
        }
        executor.execute {
            try {
                val connection = (URL("${BuildConfig.RYANAI_BASE_URL}/api/phonelink/mobile/events").openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 8000
                    readTimeout = 8000
                    setRequestProperty("Authorization", "Bearer $token")
                }
                val status = connection.responseCode
                if (status == 401) {
                    store.clear()
                    runOnUiThread { statusView.text = "PhoneLink access was revoked. Pair this phone again from RyanAI." }
                    return@execute
                }
                if (status !in 200..299) throw IllegalStateException("PhoneLink inbox returned HTTP $status.")
                val payload = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                val events = payload.optJSONArray("events")
                runOnUiThread { renderEvents(events) }
            } catch (error: Exception) {
                runOnUiThread { statusView.text = error.message ?: "PhoneLink inbox is temporarily unavailable." }
            }
        }
    }

    private fun renderEvents(events: org.json.JSONArray?) {
        eventsLayout.removeAllViews()
        val count = events?.length() ?: 0
        statusView.text = if (count == 0) "Connected · no pending RyanAI updates" else "Connected · $count pending RyanAI update(s)"
        if (count == 0) {
            eventsLayout.addView(TextView(this).apply {
                text = "Your RyanAI Comms and workspace updates will appear here."
                setTextColor(android.graphics.Color.LTGRAY)
                textSize = 14f
            })
            return
        }
        for (index in 0 until count) {
            val event = events?.optJSONObject(index) ?: continue
            val id = event.optString("id")
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(16, 14, 16, 14)
                setBackgroundColor(android.graphics.Color.rgb(17, 31, 49))
            }
            card.addView(TextView(this).apply {
                text = event.optString("title", "RyanAI update")
                textSize = 16f
                setTextColor(android.graphics.Color.WHITE)
            })
            card.addView(TextView(this).apply {
                text = event.optString("body")
                textSize = 13f
                setTextColor(android.graphics.Color.LTGRAY)
                setPadding(0, 6, 0, 8)
            })
            card.addView(Button(this).apply {
                text = "Acknowledge"
                setOnClickListener { acknowledge(id) }
            })
            val params = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            params.bottomMargin = 12
            eventsLayout.addView(card, params)
        }
    }

    private fun acknowledge(eventId: String) {
        val token = store.read() ?: return
        executor.execute {
            try {
                val connection = (URL("${BuildConfig.RYANAI_BASE_URL}/api/phonelink/mobile/events/$eventId/ack").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 8000
                    readTimeout = 8000
                    setRequestProperty("Authorization", "Bearer $token")
                    doOutput = true
                    setRequestProperty("Content-Length", "0")
                }
                if (connection.responseCode !in 200..299) throw IllegalStateException("Could not acknowledge this update.")
                refreshEvents()
            } catch (error: Exception) {
                runOnUiThread { statusView.text = error.message ?: "Could not acknowledge this update." }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        handler.removeCallbacks(pollTask)
        handler.post(pollTask)
    }

    override fun onPause() {
        handler.removeCallbacks(pollTask)
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacks(pollTask)
        executor.shutdown()
        super.onDestroy()
    }
}
