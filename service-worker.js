const CACHE_NAME = "feli-food-v1";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json"
];

// FIREBASE MESSAGING SUPPORT
importScripts(
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "AIzaSyASId2lvEXuucygOz1ETx60OyHvKFiQNqw",
  authDomain: "feli-food.firebaseapp.com",
  projectId: "feli-food",
  storageBucket: "feli-food.firebasestorage.app",
  messagingSenderId: "132325587813",
  appId: "1:132325587813:web:12b60e962263afa49c7f8c"
});

const messaging = firebase.messaging();
// FELI FOOD BACKGROUND NOTIFICATIONS
messaging.onBackgroundMessage((payload) => {
  console.log("Feli Food background notification:", payload);

  const title =
    payload.notification?.title || "Feli Food";

  const options = {
    body:
      payload.notification?.body || "You have a new update.",
    icon: "./feli-icon-192.png",
    badge: "./feli-icon-192.png"
  };

  return self.registration.showNotification(title, options);
});
// INSTALL AND CACHE
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );

  self.skipWaiting();
});

// ACTIVATE
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );

  self.clients.claim();
});

// NOTIFICATION CLICK
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          return client.focus();
        }
      }

      return clients.openWindow("./");
    })
  );
});

// OFFLINE SUPPORT
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});