package com.anonymous.expenso.smsreceiver

import android.content.Context
import android.content.IntentFilter
import android.database.Cursor
import android.os.Build
import android.os.SystemClock
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SMSReceiverModule : Module() {

  private var receiver: SMSBroadcastReceiver? = null
  private var registered: Boolean = false

  private val dedupeLock = Any()
  private var lastDedupeKey: String? = null
  private var lastDedupeAt: Long = 0L

  private fun emitSmsToJs(body: String, sender: String) {
    val now = SystemClock.elapsedRealtime()
    val key = "$sender\u0001$body"
    synchronized(dedupeLock) {
      if (key == lastDedupeKey && now - lastDedupeAt < 400L) return
      lastDedupeKey = key
      lastDedupeAt = now
    }
    sendEvent(
      "onSMSReceived",
      mapOf(
        "body" to body,
        "sender" to sender
      )
    )
  }

  override fun definition() = ModuleDefinition {
    Name("SMSReceiver")

    Events("onSMSReceived")

    Function("startListening") {
      if (registered) return@Function null

      val appCtx = appContext.reactContext?.applicationContext
        ?: return@Function null

      val handler: (String, String) -> Unit = { body, sender ->
        emitSmsToJs(body, sender)
      }

      SMSBroadcastReceiver.sharedHandler = handler
      val r = SMSBroadcastReceiver(handler)
      receiver = r

      val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        appCtx.registerReceiver(r, filter, Context.RECEIVER_EXPORTED)
      } else {
        @Suppress("DEPRECATION")
        appCtx.registerReceiver(r, filter)
      }
      registered = true
      null
    }

    Function("stopListening") {
      SMSBroadcastReceiver.sharedHandler = null

      if (!registered) return@Function null

      val appCtx = appContext.reactContext?.applicationContext
      val r = receiver
      receiver = null
      registered = false

      if (appCtx != null && r != null) {
        try {
          appCtx.unregisterReceiver(r)
        } catch (_: IllegalArgumentException) {
          // Not registered
        }
      }
      null
    }

    Function("getRecentInboxSMS") { limit: Int? ->
      val appCtx = appContext.reactContext?.applicationContext
        ?: return@Function emptyList<Map<String, Any?>>()

      val safeLimit = (limit ?: 200).coerceIn(1, 1000)
      val resolver = appCtx.contentResolver
      val uri = Telephony.Sms.Inbox.CONTENT_URI
      val projection = arrayOf(
        Telephony.Sms.BODY,
        Telephony.Sms.ADDRESS,
        Telephony.Sms.DATE
      )

      val rows = mutableListOf<Map<String, Any?>>()
      var cursor: Cursor? = null
      try {
        // NOTE: Many Android builds reject "LIMIT" in sortOrder; cap rows in code instead.
        cursor = resolver.query(
          uri,
          projection,
          null,
          null,
          "${Telephony.Sms.DATE} DESC"
        )
        if (cursor != null) {
          val bodyCol = cursor.getColumnIndex(Telephony.Sms.BODY)
          val addressCol = cursor.getColumnIndex(Telephony.Sms.ADDRESS)
          val dateCol = cursor.getColumnIndex(Telephony.Sms.DATE)

          while (cursor.moveToNext() && rows.size < safeLimit) {
            val body = if (bodyCol >= 0) cursor.getString(bodyCol) else null
            val sender = if (addressCol >= 0) cursor.getString(addressCol) else null
            val dateMillis = if (dateCol >= 0) cursor.getLong(dateCol) else 0L
            if (!body.isNullOrBlank()) {
              rows.add(
                mapOf(
                  "body" to body,
                  "sender" to (sender ?: ""),
                  "dateMillis" to dateMillis
                )
              )
            }
          }
        }
      } catch (_: SecurityException) {
        // READ_SMS missing
      } catch (_: IllegalArgumentException) {
        // Invalid projection/sort on some OEMs
      } finally {
        cursor?.close()
      }
      rows
    }
  }
}
