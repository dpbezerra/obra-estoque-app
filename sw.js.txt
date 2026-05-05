const CACHE_NAME = "obra-estoque-cache-v1";

const urlsToCache = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json",
    "https://unpkg.com/dexie@3.2.4/dist/dexie.js"
];

self.addEventListener("install", function(event){
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener("fetch", function(event){
    event.respondWith(
        caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
});