package com.anonymous.expenso.smsreceiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.telephony.SmsMessage

/**
 * Receives [Telephony.Sms.Intents.SMS_RECEIVED_ACTION].
 * Uses [directHandler] when non-null (dynamically registered instance);
 * otherwise falls back to [sharedHandler] (manifest-delivered instance).
 */
class SMSBroadcastReceiver(
  private val directHandler: ((String, String) -> Unit)? = null
) : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val messages = readMessagesFromIntent(intent)
    if (messages.isEmpty()) return
    val body = messages.joinToString(separator = "") { it.messageBody ?: "" }
    val sender = messages.firstOrNull()?.originatingAddress ?: ""
    val handler = directHandler ?: sharedHandler ?: return
    handler(body, sender)
  }

  companion object {
    @Volatile
    var sharedHandler: ((String, String) -> Unit)? = null
  }
}

private fun readMessagesFromIntent(intent: Intent): List<SmsMessage> {
  Telephony.Sms.Intents.getMessagesFromIntent(intent)?.toList()?.let { return it }
  val extras = intent.extras ?: return emptyList()
  @Suppress("DEPRECATION")
  val pdus = extras.get("pdus") as? Array<*> ?: return emptyList()
  val format = extras.getString("format")
  return pdus.mapNotNull { raw ->
    val pdu = raw as? ByteArray ?: return@mapNotNull null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      SmsMessage.createFromPdu(pdu, format)
    } else {
      @Suppress("DEPRECATION")
      SmsMessage.createFromPdu(pdu)
    }
  }
}
