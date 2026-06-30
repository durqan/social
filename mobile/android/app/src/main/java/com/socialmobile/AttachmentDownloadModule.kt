package com.socialmobile

import android.Manifest
import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.MimeTypeMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import java.io.File
import java.io.FileOutputStream

class AttachmentDownloadModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), PermissionListener {
  private var pendingSave: PendingBase64Save? = null

  override fun getName(): String = NAME

  @ReactMethod
  fun downloadHttp(
    url: String,
    fileName: String?,
    mimeType: String?,
    cookieHeader: String?,
    promise: Promise
  ) {
    try {
      val parsedUrl = Uri.parse(url)
      val scheme = parsedUrl.scheme?.lowercase()
      if (scheme != "http" && scheme != "https") {
        promise.reject("E_DOWNLOAD_URL", "Only HTTP downloads are supported")
        return
      }

      val safeFileName = sanitizeFileName(fileName)
      val resolvedMimeType = resolveMimeType(safeFileName, mimeType)
      val request = DownloadManager.Request(parsedUrl)
        .setTitle(safeFileName)
        .setDescription("Social")
        .setMimeType(resolvedMimeType)
        .setNotificationVisibility(
          DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
        )
        .setAllowedOverMetered(true)
        .setAllowedOverRoaming(true)
        .setDestinationInExternalPublicDir(
          Environment.DIRECTORY_DOWNLOADS,
          safeFileName
        )

      if (!cookieHeader.isNullOrBlank()) {
        request.addRequestHeader("Cookie", cookieHeader)
      }
      System.getProperty("http.agent")?.takeIf { it.isNotBlank() }?.let {
        request.addRequestHeader("User-Agent", it)
      }

      val manager =
        reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      val downloadId = manager.enqueue(request)
      promise.resolve(downloadId.toDouble())
    } catch (error: RuntimeException) {
      promise.reject("E_DOWNLOAD_FAILED", "Failed to start download", error)
    }
  }

  @ReactMethod
  fun saveBase64File(
    base64: String,
    fileName: String?,
    mimeType: String?,
    promise: Promise
  ) {
    val pending = PendingBase64Save(base64, fileName, mimeType, promise)

    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
      reactContext.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
      != PackageManager.PERMISSION_GRANTED
    ) {
      requestLegacyStoragePermission(pending)
      return
    }

    saveBase64FileWithPermission(pending)
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<String>,
    grantResults: IntArray
  ): Boolean {
    if (requestCode != WRITE_STORAGE_REQUEST_CODE) {
      return false
    }

    val pending = pendingSave ?: return true
    pendingSave = null
    val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
    if (!granted) {
      pending.promise.reject(
        "E_DOWNLOAD_PERMISSION",
        "Storage permission was denied"
      )
      return true
    }

    saveBase64FileWithPermission(pending)
    return true
  }

  private fun requestLegacyStoragePermission(pending: PendingBase64Save) {
    val activity = reactContext.currentActivity
    if (activity !is PermissionAwareActivity) {
      pending.promise.reject(
        "E_DOWNLOAD_PERMISSION",
        "Storage permission cannot be requested"
      )
      return
    }

    if (pendingSave != null) {
      pending.promise.reject(
        "E_DOWNLOAD_BUSY",
        "Another file save is waiting for permission"
      )
      return
    }

    pendingSave = pending
    activity.requestPermissions(
      arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE),
      WRITE_STORAGE_REQUEST_CODE,
      this
    )
  }

  private fun saveBase64FileWithPermission(pending: PendingBase64Save) {
    try {
      val safeFileName = sanitizeFileName(pending.fileName)
      val resolvedMimeType = resolveMimeType(safeFileName, pending.mimeType)
      val bytes = Base64.decode(pending.base64, Base64.DEFAULT)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val resolver = reactContext.contentResolver
        val values = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, safeFileName)
          put(MediaStore.MediaColumns.MIME_TYPE, resolvedMimeType)
          put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(
          MediaStore.Downloads.EXTERNAL_CONTENT_URI,
          values
        ) ?: throw IllegalStateException("Cannot create download entry")

        try {
          resolver.openOutputStream(uri)?.use { output ->
            output.write(bytes)
          } ?: throw IllegalStateException("Cannot open download entry")
          values.clear()
          values.put(MediaStore.MediaColumns.IS_PENDING, 0)
          resolver.update(uri, values, null, null)
          pending.promise.resolve(uri.toString())
        } catch (error: RuntimeException) {
          resolver.delete(uri, null, null)
          throw error
        }
        return
      }

      val downloadsDir =
        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
      if (!downloadsDir.exists() && !downloadsDir.mkdirs()) {
        throw IllegalStateException("Cannot create Downloads directory")
      }
      val target = uniqueLegacyFile(downloadsDir, safeFileName)
      FileOutputStream(target).use { output ->
        output.write(bytes)
      }
      MediaScannerConnection.scanFile(
        reactContext,
        arrayOf(target.absolutePath),
        arrayOf(resolvedMimeType),
        null
      )
      pending.promise.resolve(target.absolutePath)
    } catch (error: IllegalArgumentException) {
      pending.promise.reject("E_DOWNLOAD_BASE64", "Invalid file data", error)
    } catch (error: RuntimeException) {
      pending.promise.reject("E_DOWNLOAD_FAILED", "Failed to save file", error)
    }
  }

  private fun sanitizeFileName(fileName: String?): String {
    val cleaned = fileName
      ?.substringAfterLast('/')
      ?.substringAfterLast('\\')
      ?.replace(Regex("[\\p{Cntrl}:*?\"<>|]"), "_")
      ?.trim()
      ?.take(140)

    return cleaned?.takeIf { it.isNotBlank() } ?: "social-download.bin"
  }

  private fun resolveMimeType(fileName: String, mimeType: String?): String {
    mimeType?.trim()?.takeIf { it.isNotBlank() }?.let { return it }
    val extension = fileName.substringAfterLast('.', missingDelimiterValue = "")
    return MimeTypeMap.getSingleton()
      .getMimeTypeFromExtension(extension.lowercase())
      ?: "application/octet-stream"
  }

  private fun uniqueLegacyFile(directory: File, fileName: String): File {
    var candidate = File(directory, fileName)
    if (!candidate.exists()) {
      return candidate
    }

    val dotIndex = fileName.lastIndexOf('.')
    val baseName = if (dotIndex > 0) fileName.substring(0, dotIndex) else fileName
    val extension = if (dotIndex > 0) fileName.substring(dotIndex) else ""
    var suffix = 1
    while (candidate.exists()) {
      candidate = File(directory, "$baseName ($suffix)$extension")
      suffix += 1
    }
    return candidate
  }

  private data class PendingBase64Save(
    val base64: String,
    val fileName: String?,
    val mimeType: String?,
    val promise: Promise
  )

  companion object {
    const val NAME = "AttachmentDownload"
    private const val WRITE_STORAGE_REQUEST_CODE = 4318
  }
}
