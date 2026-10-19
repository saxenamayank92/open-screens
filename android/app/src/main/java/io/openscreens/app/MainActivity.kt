package io.openscreens.app

import android.app.Activity
import android.app.AlertDialog
import android.content.SharedPreferences
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.AtomicFile
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.mindrot.jbcrypt.BCrypt

class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private val http =
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .followRedirects(false)
            .build()
    private lateinit var credentials: Credentials
    private lateinit var mediaDir: File
    private lateinit var manifestFile: AtomicFile
    private var web: WebView? = null
    @Volatile private var active: JSONObject? = null
    @Volatile private var staged: JSONObject? = null
    @Volatile private var paired = false
    @Volatile private var renderReady = false
    private var codeExpires = 0L
    private var pairingCode = ""
    private var nextPoll = 0L
    private var nextHeartbeat = 0L
    private var backoff = 2000L
    private var lastRender = 0L
    private var watchdogReloads = 0
    private var lastKey = 0L
    private var resetPresses = 0
    @Volatile private var lastError = ""
    private var lastAck = ""
    @Volatile private var pendingAck: JSONObject? = null
    private lateinit var syncState: SharedPreferences
    @Volatile private var lastSyncAt = 0L
    private var lastSyncSaved = 0L
    private var lastSyncPushed = 0L
    private val watchdog =
        object : Runnable {
            override fun run() {
                if (
                    paired && System.currentTimeMillis() - lastRender > 60000 && watchdogReloads < 3
                ) {
                    watchdogReloads++
                    lastRender = System.currentTimeMillis()
                    showRenderer()
                }
                main.postDelayed(this, 15000)
            }
        }
    private var pairingView: TextView? = null
    private var resetView: AlertDialog? = null

    private fun api(path: String) = BuildConfig.BASE_URL.trimEnd('/') + "/api/v1/device/" + path

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.keepScreenOn = true
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        credentials = Credentials(this)
        mediaDir = File(filesDir, "media").apply { mkdirs() }
        manifestFile = AtomicFile(File(filesDir, "assignment.json"))
        syncState = getSharedPreferences("sync", MODE_PRIVATE)
        lastSyncAt = syncState.getLong("lastSyncAt", 0L)
        paired = credentials.get("paired") == "true"
        active =
            try {
                JSONObject(String(manifestFile.readFully()))
            } catch (_: Exception) {
                null
            }
        if (paired) showRenderer() else showPairing()
        main.postDelayed(watchdog, 15000)
        worker.scheduleWithFixedDelay(
            {
                try {
                    tick()
                } catch (e: Exception) {
                    lastError = (e.message ?: "Connection unavailable").take(500)
                    nextPoll = System.currentTimeMillis() + backoff
                    backoff = (backoff * 2).coerceAtMost(30000)
                }
            },
            0,
            1,
            TimeUnit.SECONDS,
        )
    }

    private fun request(
        path: String,
        body: JSONObject? = null,
        challenge: Boolean = false,
    ): Pair<Int, String> {
        val builder = Request.Builder().url(api(path))
        val token = credentials.get(if (challenge) "challenge" else "token")
        if (token != null) builder.header("Authorization", "Bearer $token")
        if (body != null)
            builder.post(body.toString().toRequestBody("application/json".toMediaType()))
        return http.newCall(builder.build()).execute().use { it.code to (it.body?.string() ?: "") }
    }

    private fun showPairing() {
        main.post {
            web?.destroy()
            web = null
            renderReady = false
            val box =
                LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER
                    setBackgroundColor(Color.rgb(7, 13, 30))
                    setPadding(60, 35, 60, 35)
                }
            val crest =
                ImageView(this).apply {
                    setImageResource(R.drawable.crest)
                }
            box.addView(crest, LinearLayout.LayoutParams(90, 110))
            box.addView(
                TextView(this).apply {
                    text = "OPENSCREENS\nDisplay Receiver"
                    textSize = 24f
                    setTextColor(Color.rgb(232, 220, 206))
                    gravity = Gravity.CENTER
                    setPadding(0, 18, 0, 18)
                }
            )
            pairingView =
                TextView(this).apply {
                    text = if (pairingCode.isEmpty()) "Connecting securely…" else pairingCode
                    textSize = 44f
                    setTextColor(Color.WHITE)
                    gravity = Gravity.CENTER
                }
            box.addView(pairingView)
            box.addView(
                TextView(this).apply {
                    text =
                        "Open ${BuildConfig.BASE_URL}/pair\non your phone or computer.\n\nNo administrator password is needed on this television."
                    textSize = 16f
                    setTextColor(Color.LTGRAY)
                    gravity = Gravity.CENTER
                    setPadding(0, 20, 0, 0)
                }
            )
            setContentView(box)
        }
    }

    private fun showRenderer() {
        main.post {
            if (isFinishing) return@post
            web?.destroy()
            renderReady = false
            val view = WebView(this)
            web = view
            view.setBackgroundColor(Color.rgb(7, 13, 30))
            view.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = false
                allowFileAccess = false
                allowContentAccess = false
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
                mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                mediaPlaybackRequiresUserGesture = false
            }
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            val loader =
                WebViewAssetLoader.Builder()
                    .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
                    .addPathHandler(
                        "/media/",
                        WebViewAssetLoader.InternalStoragePathHandler(this, mediaDir),
                    )
                    .addPathHandler("/fonts/") { path ->
                        try {
                            WebResourceResponse(
                                "font/woff2",
                                null,
                                assets.open("renderer/fonts/$path"),
                            )
                        } catch (_: Exception) {
                            null
                        }
                    }
                    .build()
            view.webViewClient =
                object : WebViewClient() {
                    override fun shouldInterceptRequest(
                        v: WebView,
                        r: WebResourceRequest,
                    ): WebResourceResponse? {
                        return loader.shouldInterceptRequest(r.url)
                            ?: WebResourceResponse(
                                "text/plain",
                                "utf-8",
                                403,
                                "Forbidden",
                                emptyMap(),
                                "Blocked".byteInputStream(),
                            )
                    }

                    override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest) = true

                    override fun onRenderProcessGone(
                        v: WebView,
                        detail: RenderProcessGoneDetail,
                    ): Boolean {
                        v.destroy()
                        web = null
                        if (watchdogReloads++ < 3) main.postDelayed({ showRenderer() }, 2000)
                        return true
                    }
                }
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                lastError = "Update Android System WebView to use this receiver."
                showMessage(lastError)
                return@post
            }
            WebViewCompat.addWebMessageListener(
                view,
                "Screens",
                setOf("https://appassets.androidplatform.net"),
            ) { _, message, _, isMainFrame, _ ->
                if (isMainFrame)
                    try {
                        val data = JSONObject(message.data ?: "{}")
                        when (data.optString("type")) {
                            "ready" -> {
                                renderReady = true
                                pushManifest()
                                pushSyncStatus()
                            }
                            "render" -> {
                                val current = staged ?: active
                                if (
                                    current != null &&
                                        data.optString("revision") == current.optString("revision")
                                ) {
                                    if (staged === current) {
                                        active = current
                                        staged = null
                                        worker.execute {
                                            val stream = manifestFile.startWrite()
                                            try {
                                                stream.write(current.toString().toByteArray())
                                                manifestFile.finishWrite(stream)
                                            } catch (e: Exception) {
                                                manifestFile.failWrite(stream)
                                            }
                                        }
                                    }
                                    lastRender = System.currentTimeMillis()
                                    watchdogReloads = 0
                                    val slideId = data.optString("slideId")
                                    val key = current.optString("revision") + ":" + slideId
                                    if (lastAck != key) {
                                        lastAck = key
                                        val slides = current.getJSONArray("slides")
                                        var liveRevision = 0
                                        for (i in 0 until slides.length()) if (
                                            slides.getJSONObject(i).optString("id") == slideId
                                        )
                                            liveRevision =
                                                slides.getJSONObject(i).optInt("liveRevision", 0)
                                        pendingAck =
                                            JSONObject()
                                                .put("revision", current.getString("revision"))
                                                .put("assignmentId", current.opt("assignmentId"))
                                                .put("contentId", current.opt("contentId"))
                                                .put("version", current.getInt("version"))
                                                .put("slideId", slideId)
                                                .put("rendererVersion", 1)
                                                .put("liveRevision", liveRevision)
                                                .put(
                                                    "renderedAt",
                                                    java.time.Instant.now().toString(),
                                                )
                                    }
                                }
                            }
                            "health" -> {
                                if (data.optString("revision") == active?.optString("revision"))
                                    lastRender = System.currentTimeMillis()
                            }
                            "error" -> {
                                lastError = data.optString("message").take(500)
                                if (staged != null) {
                                    staged = null
                                    pushManifest()
                                }
                            }
                        }
                    } catch (_: Exception) {}
            }
            setContentView(view)
            view.loadUrl("https://appassets.androidplatform.net/assets/renderer/index.html")
            lastRender = System.currentTimeMillis()
        }
    }

    private fun pushManifest() {
        val m = staged ?: active ?: return
        if (renderReady)
            main.post {
                web?.evaluateJavascript(
                    "window.receiveManifest && window.receiveManifest(${m});",
                    null,
                )
            }
    }

    private fun pushSyncStatus() {
        if (renderReady)
            main.post {
                web?.evaluateJavascript(
                    "window.receiveSyncStatus && window.receiveSyncStatus({lastSyncAt: $lastSyncAt});",
                    null,
                )
            }
    }

    private fun showMessage(message: String) {
        main.post {
            setContentView(
                TextView(this).apply {
                    text = message
                    textSize = 24f
                    setTextColor(Color.WHITE)
                    setBackgroundColor(Color.rgb(7, 13, 30))
                    gravity = Gravity.CENTER
                }
            )
        }
    }

    private fun tick() {
        val now = System.currentTimeMillis()
        if (now < nextPoll) return
        if (!paired) {
            if (now >= codeExpires) {
                credentials.set("challenge", Credentials.random())
                credentials.set("token", Credentials.random())
                val (status, body) =
                    request(
                        "register",
                        JSONObject()
                            .put("challenge", credentials.get("challenge"))
                            .put("token", credentials.get("token")),
                    )
                if (status != 200) throw Exception("Pairing unavailable")
                val data = JSONObject(body)
                pairingCode = data.getString("code")
                codeExpires = now + 290000
                main.post { pairingView?.text = pairingCode }
            }
            val (status, body) = request("pair-status", challenge = true)
            if (status == 200 && JSONObject(body).optBoolean("paired")) {
                paired = true
                credentials.set("paired", "true")
                val (configStatus, config) = request("config")
                if (configStatus == 200)
                    credentials.set("resetPinHash", JSONObject(config).getString("resetPinHash"))
                showRenderer()
                nextPoll = 0
            } else nextPoll = now + 2000
            return
        }
        val (status, body) = request("sync")
        if (status == 401 || status == 403) {
            revoke()
            return
        }
        if (status != 200) throw Exception("Synchronization failed")
        lastSyncAt = now
        if (now - lastSyncSaved >= 60000) {
            syncState.edit().putLong("lastSyncAt", now).apply()
            lastSyncSaved = now
        }
        if (now - lastSyncPushed >= 30000) {
            lastSyncPushed = now
            pushSyncStatus()
        }
        if (credentials.get("resetPinHash") == null) {
            val (cs, cb) = request("config")
            if (cs == 200) credentials.set("resetPinHash", JSONObject(cb).getString("resetPinHash"))
        }
        val candidate = JSONObject(body)
        if (candidate.optInt("schemaVersion") != 1 || candidate.optInt("rendererVersion") != 1) {
            lastError = "This content requires an application update."
        } else if ((staged ?: active)?.optString("revision") != candidate.optString("revision")) {
            try {
                prepare(candidate)
                staged = candidate
                lastAck = ""
                pushManifest()
            } catch (e: Exception) {
                lastError = (e.message ?: "Media download failed").take(500)
            }
        }
        val commands = candidate.optJSONArray("commands") ?: JSONArray()
        for (i in 0 until commands.length()) {
            val command = commands.getJSONObject(i)
            if (command.optString("kind") == "refresh") {
                main.post { showRenderer() }
                request("command", JSONObject().put("id", command.getString("id")))
            }
        }
        if (now >= nextHeartbeat) {
            val metrics = resources.displayMetrics
            request(
                "heartbeat",
                JSONObject()
                    .put("appVersion", BuildConfig.VERSION_NAME)
                    .put("resolution", "${metrics.widthPixels}x${metrics.heightPixels}")
                    .put("rendererVersion", 1),
            )
            nextHeartbeat = now + 30000
        }
        pendingAck?.let {
            val (code, _) = request("ack", it)
            if (code == 200 && pendingAck === it) pendingAck = null
        }
        if (lastError.isNotEmpty()) {
            val (code, _) =
                request(
                    "error",
                    JSONObject()
                        .put("message", lastError)
                        .put("revision", active?.optString("revision") ?: ""),
                )
            if (code == 200) lastError = ""
        }
        backoff = 2000
        nextPoll = now + if (candidate.optBoolean("live")) 1000 else 2000
    }

    private fun prepare(candidate: JSONObject) {
        val entries = candidate.getJSONObject("assets")
        val pinned = mutableSetOf<String>()
        active?.optJSONObject("assets")?.let { a ->
            a.keys().forEach { k ->
                val assetObj = a.getJSONObject(k)
                val sha = assetObj.getString("sha256")
                val mime = assetObj.optString("mimeType", "")
                val ext = when {
                    mime.startsWith("video/mp4") -> ".mp4"
                    mime.startsWith("video/webm") -> ".webm"
                    mime.startsWith("video/") -> ".mp4"
                    else -> ".webp"
                }
                pinned.add("$sha$ext")
            }
        }
        entries.keys().forEach { id ->
            val item = entries.getJSONObject(id)
            val sha = item.getString("sha256")
            if (!sha.matches(Regex("[a-f0-9]{64}"))) throw Exception("Invalid content checksum")
            val mime = item.optString("mimeType", "")
            val ext = when {
                mime.startsWith("video/mp4") -> ".mp4"
                mime.startsWith("video/webm") -> ".webm"
                mime.startsWith("video/") -> ".mp4"
                else -> ".webp"
            }
            val filename = "$sha$ext"
            pinned.add(filename)
            val file = File(mediaDir, filename)
            if (file.exists()) {
                val existing =
                    MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") {
                        "%02x".format(it)
                    }
                if (existing != sha) file.delete()
            }
            if (!file.exists()) {
                val url = item.getString("url")
                val remote = if (url.startsWith("/")) api("media/$id") else url
                val parsed = android.net.Uri.parse(remote)
                val base = android.net.Uri.parse(BuildConfig.BASE_URL)
                if (
                    parsed.host != base.host &&
                        !(parsed.scheme == "https" &&
                            parsed.host?.endsWith(".r2.cloudflarestorage.com") == true)
                )
                    throw Exception("Invalid media host")
                val builder = Request.Builder().url(remote)
                if (parsed.host == base.host)
                    builder.header("Authorization", "Bearer ${credentials.get("token")}")
                val data =
                    http.newCall(builder.build()).execute().use { r ->
                        if (!r.isSuccessful) throw Exception("Media download failed")
                        val source = r.body ?: throw Exception("Empty media file")
                        if (source.contentLength() > 150 * 1024 * 1024)
                            throw Exception("Media file too large")
                        val bytes =
                            source.byteStream().use { input ->
                                val output = java.io.ByteArrayOutputStream()
                                val chunk = ByteArray(8192)
                                var total = 0
                                while (true) {
                                    val count = input.read(chunk)
                                    if (count < 0) break
                                    total += count
                                    if (total > 150 * 1024 * 1024) throw Exception("Media file too large")
                                    output.write(chunk, 0, count)
                                }
                                output.toByteArray()
                            }
                        if (bytes.size > 150 * 1024 * 1024) throw Exception("Media file too large")
                        bytes
                    }
                val actual =
                    MessageDigest.getInstance("SHA-256").digest(data).joinToString("") {
                        "%02x".format(it)
                    }
                if (actual != sha) throw Exception("Media integrity failed")
                evict(pinned, data.size.toLong())
                val temporary = File(mediaDir, "$filename.tmp")
                temporary.writeBytes(data)
                if (!temporary.renameTo(file)) throw Exception("Could not commit media file")
            }
            item.put("url", "https://appassets.androidplatform.net/media/$filename")
        }
    }

    private fun evict(pinned: Set<String>, needed: Long) {
        var size = mediaDir.listFiles()?.sumOf { it.length() } ?: 0
        mediaDir
            .listFiles()
            ?.filter { it.name !in pinned }
            ?.sortedBy { it.lastModified() }
            ?.forEach {
                if (size + needed > PlaybackPolicy.CACHE_LIMIT) {
                    val bytes = it.length()
                    if (it.delete()) size -= bytes
                }
            }
        if (size + needed > PlaybackPolicy.CACHE_LIMIT)
            throw Exception("Active content exceeds cache capacity")
    }

    private fun revoke() {
        paired = false
        active = null
        staged = null
        credentials.clear()
        manifestFile.delete()
        syncState.edit().clear().apply()
        lastSyncAt = 0L
        mediaDir.listFiles()?.forEach { it.delete() }
        codeExpires = 0
        pairingCode = ""
        pendingAck = null
        showPairing()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
            val now = System.currentTimeMillis()
            resetPresses = if (now - lastKey < 1500) resetPresses + 1 else 1
            lastKey = now
            if (resetPresses >= 5) {
                resetPresses = 0
                showReset()
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun showReset() {
        if (resetView?.isShowing == true) return
        val field =
            EditText(this).apply {
                inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
                hint = "Six-digit administrator PIN"
            }
        resetView =
            AlertDialog.Builder(this)
                .setTitle("Reset this receiver?")
                .setMessage(
                    "This removes its local identity and cached content. Pairing will be required again."
                )
                .setView(field)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Reset") { _, _ ->
                    val pin = field.text.toString()
                    worker.execute {
                        val stored = credentials.get("resetPinHash")
                        val valid =
                            try {
                                stored != null &&
                                    BCrypt.checkpw(pin, stored.replace("$" + "2b$", "$" + "2a$"))
                            } catch (_: Exception) {
                                false
                            }
                        if (valid) {
                            try {
                                request("unpair", JSONObject())
                            } catch (_: Exception) {}
                            revoke()
                        } else
                            main.post {
                                AlertDialog.Builder(this)
                                    .setMessage("PIN incorrect. Ask a club administrator.")
                                    .setPositiveButton("OK", null)
                                    .show()
                            }
                    }
                }
                .create()
        resetView?.show()
    }

    override fun onDestroy() {
        main.removeCallbacks(watchdog)
        worker.shutdownNow()
        web?.destroy()
        super.onDestroy()
    }
}
