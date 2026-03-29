package inline.modules

import com.anonymous.expenso.smsreceiver.SMSReceiverModule
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module

/**
 * App-local Expo modules are not autolinked from npm; [expo.modules.kotlin.AppContext]
 * loads this class by name and merges its [getModulesMap] into the registry.
 */
class ExpoInlineModulesList : ModulesProvider {
  override fun getModulesMap(): Map<Class<out Module>, String?> =
    mapOf(SMSReceiverModule::class.java to "SMSReceiver")
}
