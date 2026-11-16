package ai.ryanai.phonelink

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class PhoneLinkSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork() = withContext(Dispatchers.IO) {
        val store = SecureTokenStore(applicationContext)
        val token = store.read() ?: return@withContext Result.success()
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
                return@withContext Result.success()
            }
            if (status !in 200..299) return@withContext Result.retry()
            val payload = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            val events = payload.optJSONArray("events") ?: return@withContext Result.success()
            if (events.length() == 0) return@withContext Result.success()

            val notificationsAllowed = Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            if (!notificationsAllowed || !NotificationManagerCompat.from(applicationContext).areNotificationsEnabled()) {
                return@withContext Result.success()
            }

            val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(NotificationChannel("ryanai_phonelink", "RyanAI PhoneLink", NotificationManager.IMPORTANCE_DEFAULT))
            }
            for (index in 0 until events.length()) {
                val event = events.optJSONObject(index) ?: continue
                val eventId = event.optString("id")
                if (eventId.isBlank()) continue
                val openIntent = Intent(applicationContext, PairingActivity::class.java)
                val pending = PendingIntent.getActivity(applicationContext, eventId.hashCode(), openIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                manager.notify(eventId.hashCode(), NotificationCompat.Builder(applicationContext, "ryanai_phonelink")
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle(event.optString("title", "RyanAI update"))
                    .setContentText(event.optString("body"))
                    .setStyle(NotificationCompat.BigTextStyle().bigText(event.optString("body")))
                    .setContentIntent(pending)
                    .setAutoCancel(true)
                    .build())

                val ack = (URL("${BuildConfig.RYANAI_BASE_URL}/api/phonelink/mobile/events/$eventId/ack").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 8000
                    readTimeout = 8000
                    setRequestProperty("Authorization", "Bearer $token")
                    doOutput = true
                    setRequestProperty("Content-Length", "0")
                }
                ack.responseCode
                ack.disconnect()
            }
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
