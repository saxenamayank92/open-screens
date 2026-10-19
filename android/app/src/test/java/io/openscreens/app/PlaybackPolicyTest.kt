package io.openscreens.app

import org.junit.Assert.*
import org.junit.Test

class PlaybackPolicyTest {
    @Test
    fun rotation() {
        assertEquals(90, PlaybackPolicy.rotation("portrait-cw"))
        assertEquals(-90, PlaybackPolicy.rotation("portrait-ccw"))
        assertEquals(180, PlaybackPolicy.rotation("landscape-180"))
        assertEquals(0, PlaybackPolicy.rotation("landscape"))
    }

    @Test
    fun incompleteContentNeverActivates() {
        assertFalse(PlaybackPolicy.shouldActivate(false, 1))
        assertFalse(PlaybackPolicy.shouldActivate(true, 2))
        assertTrue(PlaybackPolicy.shouldActivate(true, 1))
    }

    @Test
    fun internetLossKeepsContent() {
        assertTrue(PlaybackPolicy.keepCachedContent(false, true))
        assertFalse(PlaybackPolicy.keepCachedContent(false, false))
    }
}
