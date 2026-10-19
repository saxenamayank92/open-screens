package io.openscreens.app
object PlaybackPolicy {
    fun rotation(orientation: String): Int =
        when (orientation) {
            "portrait-cw" -> 90
            "portrait-ccw" -> -90
            "landscape-180" -> 180
            else -> 0
        }

    fun shouldActivate(downloaded: Boolean, rendererVersion: Int) =
        downloaded && rendererVersion == 1

    fun keepCachedContent(online: Boolean, hasCache: Boolean) = !online && hasCache

    const val CACHE_LIMIT: Long = 512L * 1024 * 1024
}
