package ai.ryanai.phonelink

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private lateinit var previewView: PreviewView
    private lateinit var statusView: TextView
    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private val scanner by lazy {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build()
        )
    }
    @Volatile private var openingPairing = false

    private val cameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) startCamera()
        else statusView.text = "Camera permission is needed to scan a RyanAI pairing QR. You can still use the manual pairing code in RyanAI."
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(24, 32, 24, 24)
            setBackgroundColor(android.graphics.Color.rgb(7, 17, 31))
        }
        val title = TextView(this).apply {
            text = "RyanAI PhoneLink"
            textSize = 25f
            setTextColor(android.graphics.Color.WHITE)
            gravity = Gravity.CENTER
        }
        statusView = TextView(this).apply {
            text = "Scan the temporary QR code shown in your authenticated RyanAI dashboard."
            textSize = 14f
            setTextColor(android.graphics.Color.LTGRAY)
            gravity = Gravity.CENTER
            setPadding(8, 20, 8, 20)
        }
        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        layout.addView(title, LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        layout.addView(statusView, LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        layout.addView(previewView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(layout)

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startCamera() {
        statusView.text = "Point your camera at the RyanAI PhoneLink QR code."
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            val provider = providerFuture.get()
            val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            analysis.setAnalyzer(cameraExecutor) { proxy ->
                val mediaImage = proxy.image
                if (mediaImage == null || openingPairing) {
                    proxy.close()
                } else {
                    val input = InputImage.fromMediaImage(mediaImage, proxy.imageInfo.rotationDegrees)
                    scanner.process(input)
                        .addOnSuccessListener { barcodes ->
                            val raw = barcodes.firstOrNull { it.format == Barcode.FORMAT_QR_CODE }?.rawValue
                            if (raw != null) runOnUiThread { openPairingLink(raw) }
                        }
                        .addOnFailureListener {
                            runOnUiThread { statusView.text = "QR scan failed. Keep the code inside the camera frame and try again." }
                        }
                        .addOnCompleteListener { proxy.close() }
                }
            }
            try {
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            } catch (_: Exception) {
                statusView.text = "The camera could not be started on this device."
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun openPairingLink(rawValue: String) {
        if (openingPairing) return
        val uri = runCatching { Uri.parse(rawValue) }.getOrNull()
        val fragment = uri?.fragment.orEmpty()
        val fragmentUri = Uri.parse("https://phonelink.invalid$fragment")
        val code = fragmentUri.getQueryParameter("code")
        val valid = uri != null
            && uri.scheme == "https"
            && uri.host.equals(BuildConfig.RYANAI_HOST, ignoreCase = true)
            && fragment.startsWith("/phonelink/pair")
            && !code.isNullOrBlank()
        if (!valid) {
            statusView.text = "This QR code is not a valid RyanAI PhoneLink pairing link."
            return
        }
        openingPairing = true
        statusView.text = "Opening RyanAI to confirm this phone. Sign in to the same account that created the code."
        startActivity(Intent(Intent.ACTION_VIEW, uri))
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        scanner.close()
        cameraExecutor.shutdown()
    }
}
