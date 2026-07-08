package com.socialmobile

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
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
  private var audioFocusRequest: AudioFocusRequest? = null
  private val audioFocusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
    Log.d(NAME, "Call audio focus changed: $focusChange")
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun setCallActive(speakerphoneOn: Boolean) {
    if (!active) {
      savedMode = audioManager.mode
      @Suppress("DEPRECATION")
      savedSpeakerphoneOn = audioManager.isSpeakerphoneOn
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        savedCommunicationDevice = audioManager.communicationDevice
      }
      requestCallAudioFocus()
      active = true
    }

    setKeepScreenOn(true)
    runAudioChange("set call audio route") {
      audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
      routeAudio(speakerphoneOn)
    }
  }

  @ReactMethod
  fun setSpeakerphoneOn(speakerphoneOn: Boolean) {
    if (!active) {
      return
    }

    runAudioChange("set call speakerphone") {
      routeAudio(speakerphoneOn)
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
      abandonCallAudioFocus()
    }
  }

  private fun requestCallAudioFocus() {
    runAudioChange("request call audio focus") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build()
          )
          .setAcceptsDelayedFocusGain(false)
          .setOnAudioFocusChangeListener(audioFocusChangeListener)
          .build()

        audioFocusRequest = request
        audioManager.requestAudioFocus(request)
      } else {
        @Suppress("DEPRECATION")
        audioManager.requestAudioFocus(
          audioFocusChangeListener,
          AudioManager.STREAM_VOICE_CALL,
          AudioManager.AUDIOFOCUS_GAIN
        )
      }
    }
  }

  private fun abandonCallAudioFocus() {
    runAudioChange("abandon call audio focus") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        audioFocusRequest?.let { request ->
          audioManager.abandonAudioFocusRequest(request)
        }
        audioFocusRequest = null
      } else {
        @Suppress("DEPRECATION")
        audioManager.abandonAudioFocus(audioFocusChangeListener)
      }
    }
  }

  private fun routeAudio(speakerphoneOn: Boolean) {
    if (speakerphoneOn) {
      routeToSpeaker()
    } else {
      routeToPrivateAudio()
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

  private fun routeToPrivateAudio() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val privateDeviceTypes = listOf(
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_BLE_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
      )
      val privateDevice = privateDeviceTypes
        .asSequence()
        .mapNotNull { type ->
          audioManager.availableCommunicationDevices.firstOrNull {
            it.type == type
          }
        }
        .firstOrNull()

      if (privateDevice != null && audioManager.setCommunicationDevice(privateDevice)) {
        return
      }

      audioManager.clearCommunicationDevice()
    }

    @Suppress("DEPRECATION")
    audioManager.isSpeakerphoneOn = false
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
