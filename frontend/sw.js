/**
 * Service Worker - 缓存策略优化
 * 提供离线访问、静态资源缓存、API数据缓存等功能
 */

const CACHE_VERSION = 'poetize-v1.1.0';
const CACHE_NAME = `poetize-cache-${CACHE_VERSION}`;
const OFFLINE_PAGE = '/offline.html';
const NOTIFICATION_TAG = 'poetize-notification';

// 需要缓存的静态资源
const STATIC_CACHE_URLS = [
  '/',
  '/index.html',
  '/poetize.jpg',
  '/manifest.json',
  '/offline.html'
];

// 缓存策略配置
const CACHE_STRATEGIES = {
  // 静态资源：缓存优先
  static: /\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot)$/,
  // API数据：网络优先，失败时使用缓存
  api: /\/api\//,
  // 图片资源：缓存优先
  image: /\.(png|jpg|jpeg|gif|svg|webp|ico)$/,
  // 字体文件：缓存优先
  font: /\.(woff2?|ttf|eot)$/
};

// 缓存时长配置（秒）
const CACHE_DURATION = {
  static: 7 * 24 * 60 * 60,      // 静态资源：7天
  api: 5 * 60,                    // API数据：5分钟
  image: 30 * 24 * 60 * 60,       // 图片：30天
  font: 365 * 24 * 60 * 60        // 字体：1年
};

/**
 * Service Worker 安装事件
 */
self.addEventListener('install', (event) => {
  console.log('[Service Worker] 正在安装...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] 缓存静态资源');
        return cache.addAll(STATIC_CACHE_URLS);
      })
      .then(() => {
        // 强制激活新的 Service Worker
        return self.skipWaiting();
      })
  );
});

/**
 * Service Worker 激活事件
 */
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] 正在激活...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        // 删除旧版本缓存
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME && cacheName.startsWith('poetize-cache-')) {
              console.log('[Service Worker] 删除旧缓存:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // 立即接管所有页面
        return self.clients.claim();
      })
  );
});

/**
 * 缓存优先策略（Cache First）
 * 先从缓存读取，如果缓存不存在则从网络获取并缓存
 */
function cacheFirst(request, cacheName = CACHE_NAME, maxAge = null) {
  return caches.open(cacheName).then((cache) => {
    return cache.match(request).then((cachedResponse) => {
      // 检查缓存是否过期
      if (cachedResponse && maxAge) {
        const cachedTime = new Date(cachedResponse.headers.get('sw-cached-time'));
        const now = new Date();
        if ((now - cachedTime) / 1000 > maxAge) {
          // 缓存已过期，从网络获取
          return fetchAndCache(request, cache);
        }
      }
      
      // 返回缓存或从网络获取
      return cachedResponse || fetchAndCache(request, cache);
    });
  });
}

/**
 * 网络优先策略（Network First）
 * 先尝试从网络获取，失败时使用缓存
 */
function networkFirst(request, cacheName = CACHE_NAME, timeout = 3000) {
  return caches.open(cacheName).then((cache) => {
    return Promise.race([
      fetch(request).then((response) => {
        // 只缓存成功的响应
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          // 添加缓存时间戳
          const headers = new Headers(responseToCache.headers);
          headers.append('sw-cached-time', new Date().toISOString());
          
          const blob = responseToCache.blob();
          blob.then((body) => {
            cache.put(request, new Response(body, {
              status: responseToCache.status,
              statusText: responseToCache.statusText,
              headers: headers
            }));
          });
        }
        return response;
      }),
      // 超时后使用缓存
      new Promise((resolve, reject) => {
        setTimeout(() => {
          cache.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              console.log('[Service Worker] 网络超时，使用缓存');
              resolve(cachedResponse);
            } else {
              reject(new Error('网络请求超时且无缓存'));
            }
          });
        }, timeout);
      })
    ]);
  });
}

/**
 * 仅网络策略（Network Only）
 * 始终从网络获取，不使用缓存
 */
function networkOnly(request) {
  return fetch(request);
}

/**
 * 从网络获取并缓存
 */
function fetchAndCache(request, cache) {
  return fetch(request).then((response) => {
    // 只缓存成功的GET请求
    if (response && response.status === 200 && request.method === 'GET') {
      const responseToCache = response.clone();
      // 添加缓存时间戳
      const headers = new Headers(responseToCache.headers);
      headers.append('sw-cached-time', new Date().toISOString());
      
      responseToCache.blob().then((body) => {
        cache.put(request, new Response(body, {
          status: responseToCache.status,
          statusText: responseToCache.statusText,
          headers: headers
        }));
      });
    }
    return response;
  }).catch((error) => {
    console.error('[Service Worker] 网络请求失败:', error);
    throw error;
  });
}

/**
 * Service Worker fetch 事件
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // 只处理 GET 请求
  if (request.method !== 'GET') {
    return;
  }
  
  // 忽略非同源请求（除了字体和图片）
  if (url.origin !== location.origin && 
      !CACHE_STRATEGIES.image.test(url.pathname) && 
      !CACHE_STRATEGIES.font.test(url.pathname)) {
    return;
  }
  
  // API 请求：网络优先
  if (CACHE_STRATEGIES.api.test(url.pathname)) {
    event.respondWith(networkFirst(request, CACHE_NAME, CACHE_DURATION.api));
    return;
  }
  
  // 图片资源：缓存优先
  if (CACHE_STRATEGIES.image.test(url.pathname)) {
    event.respondWith(cacheFirst(request, CACHE_NAME, CACHE_DURATION.image));
    return;
  }
  
  // 字体文件：缓存优先
  if (CACHE_STRATEGIES.font.test(url.pathname)) {
    event.respondWith(cacheFirst(request, CACHE_NAME, CACHE_DURATION.font));
    return;
  }
  
  // 静态资源：缓存优先
  if (CACHE_STRATEGIES.static.test(url.pathname)) {
    event.respondWith(cacheFirst(request, CACHE_NAME, CACHE_DURATION.static));
    return;
  }
  
  // HTML 页面：网络优先
  if (request.headers.get('accept').includes('text/html')) {
    event.respondWith(networkFirst(request, CACHE_NAME, 2000));
    return;
  }
  
  // 其他请求：网络优先
  event.respondWith(networkFirst(request));
});

/**
 * 消息事件处理
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            return caches.delete(cacheName);
          })
        );
      }).then(() => {
        event.ports[0].postMessage({ success: true });
      })
    );
  }
  
  // 检查更新
  if (event.data && event.data.type === 'CHECK_UPDATE') {
    event.waitUntil(
      self.registration.update().then(() => {
        event.ports[0].postMessage({ hasUpdate: true });
      })
    );
  }
});

/**
 * 推送通知事件
 */
self.addEventListener('push', (event) => {
  console.log('[Service Worker] 收到推送消息');
  
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = {
        title: '新消息',
        body: event.data.text(),
        icon: '/poetize.jpg'
      };
    }
  }
  
  const title = data.title || 'POETIZE';
  const options = {
    body: data.body || '您有新的消息',
    icon: data.icon || '/poetize.jpg',
    badge: '/poetize.jpg',
    tag: data.tag || NOTIFICATION_TAG,
    data: data.data || {},
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [
      { action: 'view', title: '查看' },
      { action: 'close', title: '关闭' }
    ],
    vibrate: [200, 100, 200],
    timestamp: Date.now()
  };
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/**
 * 通知点击事件
 */
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] 通知被点击:', event.action);
  
  event.notification.close();
  
  if (event.action === 'close') {
    return;
  }
  
  // 打开或聚焦到对应页面
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const url = event.notification.data.url || '/';
        
        // 如果已有打开的窗口，聚焦它
        for (let client of clientList) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        
        // 否则打开新窗口
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

/**
 * 通知关闭事件
 */
self.addEventListener('notificationclose', (event) => {
  console.log('[Service Worker] 通知被关闭');
});

/**
 * 后台同步事件
 */
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] 后台同步:', event.tag);
  
  if (event.tag === 'sync-articles') {
    event.waitUntil(
      // 实现文章同步逻辑
      Promise.all([
        // 同步文章列表
        fetch('/api/article/listArticle', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            current: 1,
            size: 20,
            searchKey: '',
            articleSearch: '',
            recommendStatus: null,
            sortId: null,
            labelId: null
          })
        })
        .then(response => response.json())
        .then(data => {
          console.log('[Service Worker] 文章列表同步成功:', data);
          // 将文章列表缓存到Cache Storage
          if (data && data.data && data.data.records) {
            return caches.open(CACHE_NAME).then(cache => {
              data.data.records.forEach(article => {
                // 缓存每篇文章的详情页
                const articleUrl = `/article?id=${article.id}`;
                fetch(articleUrl)
                  .then(articleRes => articleRes.text())
                  .then(articleHtml => {
                    const response = new Response(articleHtml, {
                      headers: { 'Content-Type': 'text/html' }
                    });
                    cache.put(articleUrl, response);
                  })
                  .catch(err => console.error('缓存文章失败:', err));
              });
            });
          }
        })
        .catch(error => {
          console.error('[Service Worker] 同步文章列表失败:', error);
        }),
        
        // 同步收藏数据
        fetch('/api/article/getUserCollections?current=1&size=100', {
          method: 'GET',
          credentials: 'include' // 包含认证信息
        })
        .then(response => {
          if (response.ok) {
            return response.json();
          }
          throw new Error('获取收藏数据失败');
        })
        .then(data => {
          console.log('[Service Worker] 收藏数据同步成功:', data);
          // 在IndexedDB中存储收藏数据以供前端使用
          if (typeof window !== 'undefined' && window.indexedDB) {
            const request = indexedDB.open('PoetizeDB', 1);
            
            request.onsuccess = function(event) {
              const db = event.target.result;
              const transaction = db.transaction(['collections'], 'readwrite');
              const objectStore = transaction.objectStore('collections');
              
              // 清空现有数据
              objectStore.clear().onsuccess = function() {
                // 添加新数据
                if (data && data.data && data.data.records) {
                  data.data.records.forEach(item => {
                    objectStore.add(item);
                  });
                }
              };
            };
          }
        })
        .catch(error => {
          console.error('[Service Worker] 同步收藏数据失败:', error);
        })
      ])
    );
  }
});
