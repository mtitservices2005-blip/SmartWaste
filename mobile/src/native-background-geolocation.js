import { registerPlugin } from '@capacitor/core';

// app.js feature-detects this global, so the ordinary website keeps its browser geolocation path.
globalThis.SmartWasteBackgroundGeolocation = registerPlugin('BackgroundGeolocation');
globalThis.SmartWasteLocalNotifications = registerPlugin('LocalNotifications');
