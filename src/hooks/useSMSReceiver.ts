import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import {
  EventEmitter,
  type NativeModule,
  requireNativeModule,
  type EventSubscription,
} from 'expo-modules-core';

export type SMSReceivedPayload = {
  body: string;
  sender: string;
};

type SMSReceiverEvents = {
  onSMSReceived: (event: SMSReceivedPayload) => void;
};

/** Instance shape of the `SMSReceiver` native module (Expo `NativeModule` + sync methods). */
type SMSReceiverNativeModule = InstanceType<NativeModule<SMSReceiverEvents>> & {
  startListening(): void;
  stopListening(): void;
};

void EventEmitter;

export type UseSMSReceiverOptions = {
  onSMS: (body: string, sender: string) => void;
  /** When false, native listening is not started (e.g. until SMS permissions are granted). Default true. */
  enabled?: boolean;
};

/**
 * Subscribes to incoming SMS on Android via the native `SMSReceiver` Expo module.
 * No-op on other platforms.
 */
export function useSMSReceiver(options: UseSMSReceiverOptions): void {
  const { onSMS, enabled = true } = options;
  const onSMSRef = useRef(onSMS);
  onSMSRef.current = onSMS;

  useEffect(() => {
    if (Platform.OS !== 'android' || !enabled) {
      return;
    }

    const SMSReceiver = requireNativeModule<SMSReceiverNativeModule>('SMSReceiver');
    let subscription: EventSubscription | null = null;

    SMSReceiver.startListening();
    subscription = SMSReceiver.addListener('onSMSReceived', (event: SMSReceivedPayload) => {
      onSMSRef.current(event.body, event.sender);
    });

    return () => {
      subscription?.remove();
      SMSReceiver.stopListening();
    };
  }, [enabled]);
}
