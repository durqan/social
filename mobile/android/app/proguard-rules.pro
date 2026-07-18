# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# React Native modules are reached through reflection and codegen.
-keep class com.facebook.react.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.hermes.** { *; }
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod <methods>;
}
-dontwarn com.facebook.react.**
-dontwarn com.facebook.hermes.**

# LiveKit's official React Native media package uses these native classes.
-keep class org.webrtc.** { *; }
-keep class com.oney.WebRTCModule.** { *; }
-dontwarn org.webrtc.**
-dontwarn com.oney.WebRTCModule.**

# Push, notifications and native RN modules publish consumer rules, but these
# keeps make release minification conservative for the current critical paths.
-keep class com.socialmobile.** { *; }
-keep class io.invertase.firebase.** { *; }
-keep class app.notifee.** { *; }
-keep class com.reactnativecommunity.netinfo.** { *; }
-keep class com.reactnativecommunity.asyncstorage.** { *; }
-keep class com.imagepicker.** { *; }
-keep class com.reactnativedocumentpicker.** { *; }
-keep class com.reactnativecompressor.** { *; }
-keep class com.margelo.nitro.compressor.** { *; }
-keep class com.oblador.keychain.** { *; }
-keep class com.preeternal.reactnativecookiemanager.** { *; }
-keep class com.brentvatne.** { *; }
-dontwarn com.socialmobile.**
-dontwarn io.invertase.firebase.**
-dontwarn app.notifee.**
-dontwarn com.reactnativecommunity.netinfo.**
-dontwarn com.reactnativecommunity.asyncstorage.**
-dontwarn com.imagepicker.**
-dontwarn com.reactnativedocumentpicker.**
-dontwarn com.reactnativecompressor.**
-dontwarn com.margelo.nitro.compressor.**
-dontwarn com.oblador.keychain.**
-dontwarn com.preeternal.reactnativecookiemanager.**
-dontwarn com.brentvatne.**
