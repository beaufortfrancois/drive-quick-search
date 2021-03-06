var MAX_RESULTS = 1000;
var REFRESH_INTERVAL = 10; // minutes

var items = [];
var changeId = undefined;
var token;

function init(){
  chrome.identity.getAuthToken({ 'interactive': true }, function(authToken) {
    token = authToken;

    chrome.omnibox.onInputChanged.addListener(function (text, suggest) {
      chrome.omnibox.setDefaultSuggestion({description:"Search "+text+" in Google Drive"});
      suggest(filterItems(text));
    });

    chrome.omnibox.onInputEntered.addListener(function (text) {
      var regexp = /https:\/\/[A-Za-z0-9\.-]{3,}\.[A-Za-z]{3}/;
      if (!regexp.test(text))
        chrome.tabs.update({url: "https://drive.google.com/#search/"+text});
      else
        chrome.tabs.update({url: text});
    });

    chrome.alarms.create({periodInMinutes: REFRESH_INTERVAL});
    chrome.alarms.onAlarm.addListener(function () {
      isDriveListChanged(retrieveItemsFromApi, function () { });
    });

    chrome.storage.local.get('driveChangeId', function (storage) {
      if (storage.driveChangeId) {
        changeId = storage.driveChangeId;
      }
      isDriveListChanged(retrieveItemsFromApi, retrieveItemsFromStorage);
    });
  });
}



function filterItems (query) {
  var lowerCaseQuery = query.toLowerCase();
  return items.filter(function (item) {
    return item.description.toLowerCase().indexOf(lowerCaseQuery) >= 0;
  });
}

function isDriveListChanged(changedCallback, notChangedCallback) {
  var oldId = changeId;
  retrieveDriveChangeId(function () {
    (oldId != changeId) ? changedCallback() : notChangedCallback();
  });
}

function retrieveDriveChangeId(callback) {
  var url = 'https://www.googleapis.com/drive/v2/changes';
  var request = {
    method: 'GET',
    parameters: {
      fields: 'largestChangeId'
    }
  };
  executeApiRequest(url, function (result) {
    // fail with bad credentials?
    if (result.error && result.error.code == 401) {
      // clear tokens and try again
      chrome.identity.removeCachedAuthToken({token: token}, function() {
        return init();
      });
    }
    changeId = result.largestChangeId;
    callback();
  }, request);
}

function retrieveItemsFromStorage() {
  chrome.storage.local.get('driveItems', function (storage) {
    items = storage.driveItems.map(function (item) { return JSON.parse(item); });
  });
}

// escape entities to avoid XML parsing issues with arbitrary document titles
//   github.com/kurrik/chrome-extensions/tree/master/omnibox-escaping
//   stackoverflow.com/questions/1091945/where-can-i-get-a-list-of-the-xml-document-escape-characters
function sanitizeItemTitle(title) {

  return title.replace(/"/g,"&quot;")
  .replace(/'/g,"&apos")
  .replace(/</g,"&lt;")
  .replace(/>/g,"&gt;")
  .replace(/&/g,"&amp;");
}


function retrieveItemsFromApi() {
  retrieveDriveItems([], undefined, function (result) {
    var newItems = [];
    result.forEach(function (item) {
      newItems.push({
        content:      item.alternateLink,
        description:  sanitizeItemTitle(item.title)
      });
    });
    items = newItems;
    var driveItems = items.map(function (item) { return JSON.stringify(item); });
    chrome.storage.local.set({driveItems: driveItems});
    chrome.storage.local.set({driveChangeId: changeId});
  });
}

function retrieveDriveItems(items, nextPageToken, callback) {
  var url = 'https://www.googleapis.com/drive/v2/files';
  var request = {
    method: 'GET',
    parameters: {
      fields: 'items(alternateLink,title),nextPageToken',
      maxResults: MAX_RESULTS,

      // only docs. things i've opened
      q: 'mimeType contains "google-apps" and lastViewedByMeDate > "2010-06-04T12:00:00"',

      // only files I have accessed.
      corpus: "DEFAULT",
    }
  };
  if (nextPageToken) {
    request.parameters.pageToken = nextPageToken;
  }
  executeApiRequest(url, function (result) {
    items.push.apply(items, result.items);
    if (result.nextPageToken) {
      retrieveDriveItems(items, result.nextPageToken, callback);
    } else {
      callback(items);
    }
  }, request);
}

function serialize(obj) {
  var str = [];
  for(var p in obj)
     str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
  return str.join("&");
}

function executeApiRequest(url, responseCallback, request) {
  xhr = new XMLHttpRequest();
  xhr.open(request.method, url + '?' + serialize(request.parameters), true);
  xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  xhr.responseType = 'json';
  xhr.onload = function () { responseCallback(xhr.response); }
  xhr.send();
}



// kick it off.
init();
