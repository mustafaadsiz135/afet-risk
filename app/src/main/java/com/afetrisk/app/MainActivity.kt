package com.afetrisk.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.webkit.WebViewAssetLoader

class MainActivity : ComponentActivity() {

    private lateinit var web: WebView

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            // OpenStreetMap kullanım politikası için uygulamayı tanıtan bir User-Agent
            userAgentString = "$userAgentString AfetRiskRehberi/1.0 (Android)"
        }

        web.addJavascriptInterface(Bridge(), "Android")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == HOST) return false
                openExternal(url)
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.appBack ? window.appBack() : false") { handled ->
                    if (handled != "true") finish()
                }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("https://$HOST/assets/www/index.html")

        if (!isOnline()) Toast.makeText(this, R.string.no_internet, Toast.LENGTH_LONG).show()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    private fun isOnline(): Boolean {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
        }
    }

    inner class Bridge {
        // CORS desteği olmayan resmi kaynaklar için yerel HTTP GET (yalnızca izinli alan adları)
        @JavascriptInterface
        fun httpGet(id: Int, url: String) {
            thread {
                var ok = false
                var body: String
                try {
                    val u = URL(url)
                    require(u.protocol == "https" && u.host in ALLOWED_HOSTS) { "host not allowed" }
                    val con = (u.openConnection() as HttpURLConnection).apply {
                        connectTimeout = 15000
                        readTimeout = 25000
                        setRequestProperty("User-Agent", "AfetRiskRehberi/1.0 (Android)")
                        setRequestProperty("Accept", "application/json")
                    }
                    body = con.inputStream.bufferedReader().use { it.readText() }
                    ok = con.responseCode in 200..299
                    con.disconnect()
                } catch (e: Exception) {
                    body = e.message ?: "error"
                }
                val js = "window.__nativeHttp && window.__nativeHttp($id, $ok, ${JSONObject.quote(body)})"
                runOnUiThread { web.evaluateJavascript(js, null) }
            }
        }

        @JavascriptInterface
        fun share(text: String) {
            runOnUiThread {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, text)
                }
                startActivity(Intent.createChooser(send, getString(R.string.share_title)))
            }
        }

        @JavascriptInterface
        fun openMap(lat: Double, lon: Double, label: String) {
            runOnUiThread {
                val q = Uri.encode("$lat,$lon($label)")
                val geo = Intent(Intent.ACTION_VIEW, Uri.parse("geo:$lat,$lon?q=$q"))
                try {
                    startActivity(geo)
                } catch (_: ActivityNotFoundException) {
                    openExternal(Uri.parse("https://www.openstreetmap.org/?mlat=$lat&mlon=$lon#map=15/$lat/$lon"))
                }
            }
        }
    }

    companion object {
        private const val HOST = "appassets.androidplatform.net"
        private val ALLOWED_HOSTS = setOf("www.gov.uk", "api.worldbank.org", "data.police.uk", "data.cityofchicago.org", "data.sfgov.org")
    }
}
