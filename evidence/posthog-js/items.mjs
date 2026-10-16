export const SDK_VERSION = '1.438.12';
export const ITEMS = Object.freeze({
  E1: 'Do the C-44/C-64 forced options exist and behave as named, including the compound autocapture selector?',
  E2: 'How do default, new named and reused named instances initialize, and is config.before_send the configured function?',
  E3: 'Does before_send receive the five URL fields, and does the SDK send the overwritten values?',
  E4: 'Does opt_in_capturing emit an opt-in marker, and does the adapter drop it?',
  E5: 'Which cookie, localStorage, sessionStorage and IndexedDB keys appear through the memory-persistence lifecycle?',
  E6: 'Does opt-out discard an event already accepted into the SDK send queue?',
  E7: 'Can recording start after disable_session_recording:true, does it stop, and what happens to its buffer?',
  E8: 'Do autocapture and snapshot events reach before_send with the expected fields, and is the rebuilt element chain sent?',
  E9: 'Does the recorder honor the forced options, where is its address, and does every tested in-page navigation carry an address record?',
  E10: 'What record kinds and text locations are produced, are form values masked, and is record data uncompressed?',
  E11: 'What exact text does the recorder write for an inline script element?',
  E12: 'Does reset change session and distinct IDs, and when does the SDK rotate a session itself?',
  E13: 'Does pre-importing the recorder avoid a script request, and what URL is requested without it?',
  E14: 'Does any SDK request occur before the first grant?',
  E15: 'How do flags disables, evaluation payloads, member names, cache reset and pending-response isolation behave?',
  E16: 'With Do Not Track enabled and either capture class enabled, does anything leave the SDK?',
  E17: 'Which of the eight ReplayCapability fields are established by the measured E1–E13 evidence?',
  resetCancelsPendingRequests: 'Does featureFlags.reset cancel a pending SDK evaluation so its earlier response cannot reach a later subscription?',
});

export const CAPABILITY_FIELDS = Object.freeze([
  'masksAllText', 'masksAllInputs', 'honoursBlockSelector',
  'recordsNoNetworkPayloads', 'recordsNoConsole', 'recordsNoCanvas',
  'recordsNavigationAddress', 'snapshotsPassBeforeSend',
]);
