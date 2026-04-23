// 1Password Extension - Manifest V3 Service Worker
// Shims MV2 APIs for compatibility with the original 1Password background code in global.min.js

// Shim window -> self for service worker context
if (typeof window === 'undefined') {
  self.window = self;
}

// Shim chrome.browserAction -> chrome.action (MV2 -> MV3)
if (typeof chrome !== 'undefined' && chrome.action && !chrome.browserAction) {
  chrome.browserAction = chrome.action;
}

// Shim chrome.webRequest to strip 'blocking' from extraInfoSpec (not allowed in MV3).
// The blocking webRequest for onepasswdfill URLs is replaced by declarativeNetRequest rules.json.
if (typeof chrome !== 'undefined' && chrome.webRequest) {
  const origOnBeforeRequest = chrome.webRequest.onBeforeRequest;
  if (origOnBeforeRequest) {
    const origAddListener = origOnBeforeRequest.addListener.bind(origOnBeforeRequest);
    origOnBeforeRequest.addListener = function(callback, filter, extraInfoSpec) {
      if (Array.isArray(extraInfoSpec)) {
        extraInfoSpec = extraInfoSpec.filter(s => s !== 'blocking');
        if (extraInfoSpec.length === 0) extraInfoSpec = undefined;
      }
      // With blocking removed, the callback return value is ignored by Chrome,
      // but the listener still fires for observational purposes.
      origAddListener(callback, filter, extraInfoSpec);
    };
  }
}

// Shim chrome.contextMenus.create to support MV2-style onclick handlers.
// MV3 requires an 'id' parameter and uses onClicked listener instead of inline onclick.
if (typeof chrome !== 'undefined' && chrome.contextMenus) {
  const origCreate = chrome.contextMenus.create.bind(chrome.contextMenus);
  const onclickHandlers = {};
  let menuCounter = 0;

  chrome.contextMenus.create = function(createProperties, callback) {
    if (!createProperties.id) {
      createProperties.id = '1password-menu-' + (++menuCounter);
    }
    const onclick = createProperties.onclick;
    if (onclick) {
      delete createProperties.onclick;
      onclickHandlers[createProperties.id] = onclick;
    }
    return origCreate(createProperties, callback);
  };

  chrome.contextMenus.onClicked.addListener(function(info, tab) {
    const handler = onclickHandlers[info.menuItemId];
    if (handler) {
      handler(info, tab);
    }
  });
}

// Redirect native messaging from subscription host to standalone license (SLS) host.
// The original code connects to '2bua8c4s2c.com.agilebits.1password' but standalone
// licenses use 'com.1password.1password7' which points to 1PasswordSLSNativeMessageHost.
if (typeof chrome !== 'undefined' && chrome.runtime) {
  const origConnectNative = chrome.runtime.connectNative.bind(chrome.runtime);
  chrome.runtime.connectNative = function(hostName) {
    if (hostName === '2bua8c4s2c.com.agilebits.1password') {
      hostName = 'com.1password.1password7';
    }
    return origConnectNative(hostName);
  };

  if (chrome.runtime.sendNativeMessage) {
    const origSendNative = chrome.runtime.sendNativeMessage.bind(chrome.runtime);
    chrome.runtime.sendNativeMessage = function(hostName, message, callback) {
      if (hostName === '2bua8c4s2c.com.agilebits.1password') {
        hostName = 'com.1password.1password7';
      }
      return origSendNative(hostName, message, callback);
    };
  }
}

// Suppress "Receiving end does not exist" errors from tabs.sendMessage.
// This happens when sending to tabs where the content script isn't loaded (chrome:// pages, etc).
if (typeof chrome !== 'undefined' && chrome.tabs) {
  const origSendMessage = chrome.tabs.sendMessage.bind(chrome.tabs);
  chrome.tabs.sendMessage = function(tabId, message, optionsOrCallback, callback) {
    if (typeof optionsOrCallback === 'function') {
      callback = optionsOrCallback;
      optionsOrCallback = undefined;
    }
    const wrappedCallback = function() {
      if (chrome.runtime.lastError) {
        // Silently consume "Receiving end does not exist" errors
      }
      if (callback) callback.apply(this, arguments);
    };
    if (optionsOrCallback) {
      return origSendMessage(tabId, message, optionsOrCallback, wrappedCallback);
    }
    return origSendMessage(tabId, message, wrappedCallback);
  };
}

// Import the SJCL crypto library (used by the 1Password background logic)
importScripts('ext/sjcl.js');

// Import the original 1Password background logic
importScripts('global.min.js');
