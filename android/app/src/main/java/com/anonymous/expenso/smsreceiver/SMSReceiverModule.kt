package com.anonymous.expenso.smsreceiver

import android.content.Context
import android.content.IntentFilter
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
  }
}
