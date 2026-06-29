package com.socialmobile

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.util.Log
import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

class CallAudioSessionModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  private val audioManager: AudioManager by lazy {
    reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  }
  private var active = false
  private var savedMode: Int? = null
  private var savedSpeakerphoneOn: Boolean? = null
  private var savedCommunicationDevice: AudioDeviceInfo? = null

  override fun getName(): String = NAME

  @ReactMethod
  fun setCallActive() {
    if (!active) {
      savedMode = audioManager.mode
      @Suppress("DEPRECATION")
      savedSpeakerphoneOn = audioManager.isSpeakerphoneOn
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        savedCommunicationDevice = audioManager.communicationDevice
      }
      active = true
    }

    setKeepScreenOn(true)
    runAudioChange("set call audio route") {
      audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
      routeToSpeaker()
    }
  }

  @ReactMethod
  fun clearCallActive() {
    setKeepScreenOn(false)
    if (!active) {
      return
    }

    active = false
    runAudioChange("restore call audio route") {
      restoreAudioRoute()
    }
  }

  private fun routeToSpeaker() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val speaker = audioManager.availableCommunicationDevices.firstOrNull {
        it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
      }
      if (speaker != null && audioManager.setCommunicationDevice(speaker)) {
        return
      }
    }

    @Suppress("DEPRECATION")
    audioManager.isSpeakerphoneOn = true
  }

  private fun restoreAudioRoute() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val previousDevice = savedCommunicationDevice
      val restoredDevice = previousDevice != null &&
        audioManager.availableCommunicationDevices.any {
          it.id == previousDevice.id && it.type == previousDevice.type
        } &&
        audioManager.setCommunicationDevice(previousDevice)

      if (!restoredDevice) {
        audioManager.clearCommunicationDevice()
      }
      savedCommunicationDevice = null
    }

    savedSpeakerphoneOn?.let { wasSpeakerphoneOn ->
      @Suppress("DEPRECATION")
      audioManager.isSpeakerphoneOn = wasSpeakerphoneOn
    }
    savedSpeakerphoneOn = null

    savedMode?.let { mode ->
      audioManager.mode = mode
    }
    savedMode = null
  }

  private fun setKeepScreenOn(enabled: Boolean) {
    UiThreadUtil.runOnUiThread {
      reactContext.currentActivity?.window?.let { window ->
        if (enabled) {
          window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
          window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
      }
    }
  }

  private fun runAudioChange(actionName: String, action: () -> Unit) {
    try {
      action()
    } catch (error: RuntimeException) {
      Log.w(NAME, "Failed to $actionName", error)
    }
  }

  companion object {
    const val NAME = "CallAudioSession"
  }
}
