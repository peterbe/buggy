/* global _, localForage, Howl, console, get_gravatar, serializeObject, filesize, document,
   POP_SOUNDS, isAllDigits, window, angularForage, angular, alert, moment,
   setTimeout, showCloakDialog, closeCloakDialog, escapeRegExp, DEBUG */



// saves typing
var L = function() { console.log.apply(console, arguments); };
var D = function() { console.dir.apply(console, arguments); };

if (typeof DEBUG === 'undefined') DEBUG = false;

var BUGZILLA_URL = 'https://bugzilla.mozilla.org/rest/';
var MAX_BACKGROUND_DOWNLOADS = 10;
var FETCH_NEW_BUGS_FREQUENCY = 3 * 60;
var FETCH_CHANGED_BUGS_FREQUENCY = 3 * 60 + 1;
if (DEBUG) {
  FETCH_NEW_BUGS_FREQUENCY *= 5;
  FETCH_CHANGED_BUGS_FREQUENCY *= 5;
  console.warn("NB! In DEBUG mode");
}
var CLEAN_LOCAL_STORAGE_FREQUENCY = 120;
var CLEAR_POST_QUEUE_FREQUENCY = 10;

var _INCLUDE_FIELDS = 'assigned_to,assigned_to_detail,product,component,creator,creator_detail,status,id,resolution,last_change_time,creation_time,summary';
var _ALL_POSSIBLE_STATUSES = 'UNCONFIRMED,NEW,ASSIGNED,REOPENED,RESOLVED,VERIFIED,CLOSED'.split(',');
var _ATTACHMENT_INCLUDE_FIELDS = 'id,summary,size,content_type,is_obsolete,creation_time,is_patch';

var app = angular.module('buggyApp', ['ngSanitize']);

app.filter('stringArraySort', function() {
  return function(input) {
    return input.sort();
  };
});


/* from http://jsfiddle.net/BM2gG/3/ */
app.directive('keybinding', function () {
  return {
    restrict: 'E',
    scope: {
      invoke: '&'
    },
    link: function (scope, el, attr) {
      Mousetrap.bind(attr.on, scope.invoke);
    }
  };
});

BugsController.$inject = ['$scope', '$timeout', '$http', '$interval'];

function BugsController($scope, $timeout, $http, $interval, $location) {
  'use strict';

  var _inprogress_refreshing = false;

  $scope.bugs = [];
  $scope.in_config = false;
  $scope.in_about = false;
  $scope.in_charts = false;
  $scope.email = '';
  $scope.auth_token = null;
  $scope.is_offline = false;
  $scope.all_possible_statuses = _ALL_POSSIBLE_STATUSES;
  $scope.selected_statuses = [];
  angularForage.getItem($scope, 'selected_statuses', function(value) {
    if (value !== null) {
      $scope.selected_statuses = value;
    }
  });
  $scope.product_filters = [];
  angularForage.getItem($scope, 'product_filters', function(value) {
    if (value) {
      $scope.product_filters = value;
    }
  });
  angularForage.getItem($scope, 'auth_token', function(value) {
    if (value) {
      $scope.auth_token = value;
    }
  });
  angularForage.getItem($scope, 'email', function(value) {
    if (value) {
      $scope.email = value;
    }
  });
  $scope.products = [];
  $scope.play_sounds = true;
  angularForage.getItem($scope, 'play_sounds', function(value) {
    if (value !== null) $scope.play_sounds = value;
  });

  $scope.email_to_name = {};
  angularForage.getItem($scope, 'email_to_name', function(value) {
    if (value !== null) {
      $scope.email_to_name = value;
    }
  });

  $scope.config_stats = {
     data_downloaded_human: '',
     total_data_downloaded_human: '',
     total_comments: 0
  };

  $scope.data_downloaded = 0;  // this session
  $scope.total_data_downloaded = 0; // persistent with local storage
  angularForage.getItem($scope, 'total_data_downloaded', function(value) {
    if (value !== null) {
      $scope.total_data_downloaded = value;
    }
  });
  function logDataDownloaded(data) {
    var amount = JSON.stringify(data).length;
    $scope.data_downloaded += amount;
    $scope.total_data_downloaded += amount;
    localForage.setItem('total_data_downloaded', $scope.total_data_downloaded);
  }

  /* Used to put a notice loading message on the screen */
  $scope.loading = null;
  function startLoading(msg) {
    $scope.loading = {message: msg};
  }
  function stopLoading() {
    $scope.loading = null;
  }

  $scope.error_notice = null;
  function setErrorNotice(msg, options) {
    options = options || {};
    var delay = options.delay || 10;
    $scope.error_notice = msg;
    $timeout(function() {
      $scope.error_notice = null;
    }, delay * 1000);
  }

  var original_document_title = document.title;
  $scope.general_notice = null;
  function setGeneralNotice(msg, options) {
    options = options || {};
    var delay = options.delay || 10;
    $scope.general_notice = msg;
    document.title = msg;
    $timeout(function() {
      $scope.general_notice = null;
      document.title = original_document_title;
    }, delay * 1000);
  }

  $scope.filterByStatus = function(status) {
    if (status === 'ALL') {
      $scope.selected_statuses = [];
    } else if (_.contains($scope.selected_statuses, status)) {
      $scope.selected_statuses = _.filter($scope.selected_statuses, function(s) {
        return s !== status;
      });
    } else {
      $scope.selected_statuses.push(status);  // TODO uniqueness test
    }
    localForage.setItem('selected_statuses', $scope.selected_statuses);
  };

  $scope.isSelectedStatus = function(status) {
    return _.contains($scope.selected_statuses, status);
  };


  $scope.countByStatus = function(status) {
    return $scope.counts_by_status[status] || 0;
  };

  $scope.counts_by_status = {UNREAD: 0, ASSIGNED_TO: 0, CHANGED: 0};
  function reCountBugsByStatus(bugs) {
    if (!bugs) return;
    $scope.counts_by_status = {UNREAD: 0, ASSIGNED_TO: 0, CHANGED: 0, ALL: bugs.length};
    _.each(bugs, function(bug) {
      if ($scope.email == bug.assigned_to) {
        $scope.counts_by_status.ASSIGNED_TO++;
      }
      if (bug.unread) {
        $scope.counts_by_status.UNREAD++;
      }
      if (bug.is_changed) {
        $scope.counts_by_status.CHANGED++;
      }
      $scope.counts_by_status[bug.status] = 1 + ($scope.counts_by_status[bug.status] || 0);
    });
    //console.log('BUGS ARE A CHANGING');
    //console.log($scope.counts_by_status);
  }


  $scope.toggleConfig = function() {
    if (!$scope.in_config) {
      // before opening the config pane, preload some stats
      $scope.config_stats.total_bugs = $scope.bugs.length;
      $scope.config_stats.data_downloaded_human = filesize($scope.data_downloaded);
      $scope.config_stats.total_data_downloaded_human = filesize($scope.total_data_downloaded);
      countTotalComments();
      precalculateProductCounts();
      // download all selectable products if not already done so
      startSelectProducts();
    }
    $scope.in_config = ! $scope.in_config;
  };

  $scope.toggleAbout = function() {
    if ($scope.in_config && !$scope.in_about) {
      $scope.in_config = false;
    }
    $scope.in_about = ! $scope.in_about;
  };

  $scope.toggleCharts = function() {
    if (!$scope.in_charts) {
      if ($scope.in_config) {
        $scope.in_config = false;
      }
      if ($scope.in_about) {
        $scope.in_about = false;
      }
      console.log('Opening charts');
    }
    $scope.in_charts = ! $scope.in_charts;
  };

  function fetchAuthToken(params) {
    var url = BUGZILLA_URL + 'login';
    url += '?' + serializeObject(params);
    //console.log("BUGZILLA URL", url);
    return $http.get(url);
  }

  function fetchBugs(params) {
    if ($scope.auth_token) {
      params.token = $scope.auth_token;
    }
    var url = BUGZILLA_URL + 'bug';
    url += '?' + serializeObject(params);
    //console.log("BUGZILLA URL", url);
    return $http.get(url);
  }

  function fetchConfiguration(params) {
    var url = BUGZILLA_URL + 'product';
    url += '?' + serializeObject(params);
    //console.log("BUGZILLA URL", url);
    return $http.get(url);
  }

  function lastChangeTimeSorter(bug) {
    return bug.last_change_time;
  }

  function pySplit(str, sep, num) {
    var pieces = str.split(sep);
    if (arguments.length < 3) {
      return pieces;
    }
    if (pieces.length < num) {
      return pieces;
    }
    return pieces.slice(0, num).concat(pieces.slice(num).join(sep));
  }

  function fetchAndUpdateBugs(callback) {
    var _products_left = $scope.products.length;
    var bug_ids = [];
    $scope.bugs = [];
    _.each($scope.products, function(product_combo, index) {
      var params = {
         include_fields: _INCLUDE_FIELDS
      };
      var combo = pySplit(product_combo, '::', 1);
      params.product = combo[0].trim();
      params.component = combo[1].trim();

      fetchBugs(params)
        .success(function(data, status, headers, config) {
          //console.log('Success');
          $scope.is_offline = false;
          logDataDownloaded(data);
          _products_left--;
          var _bugs_left = data.bugs.length;
          _.each(data.bugs, function(bug, index) {
            // keep a list of all IDs we use
            bug_ids.push(bug.id);

            // update the local storage
            localForage.getItem(bug.id, function(existing_bug) {
              _bugs_left--;
              if (existing_bug !== null) {
                // we already have it, merge!
                bug.comments = existing_bug.comments;
                bug.extract = existing_bug.extract;
              }
              localForage.setItem(bug.id, bug);
              $scope.bugs.push(bug);
              if (!_bugs_left && !_products_left) {
                // all callbacks for all products and bugs have returned
                console.log("Storing a list of ", bug_ids.length, "bugs");
                localForage.setItem('bugs', bug_ids);
                reCountBugsByStatus($scope.bugs);
                $scope.$apply();
                if (callback) {
                  $scope.$apply(callback);
                }
              }
            });
          });
        }).error(function(data, status, headers, config) {
          console.warn('Failure to fetchBugs');
          console.log('status', status);
          if (status === 0) $scope.is_offline = true;
          //console.dir(data);
        });
    });
  }


  function fetchAndUpdateBug(bug, callback) {
    var bug_id;
    if (_.isNumber(bug)) {
      bug_id = bug;
    } else {
      bug_id = bug.id;
    }
    fetchBugs({
       id: bug_id,
      include_fields: _INCLUDE_FIELDS + ',groups'
    }).success(function(data, status, headers, config) {
      //console.log('Success');
      $scope.is_offline = false;
      logDataDownloaded(data);
      //console.log("FETCHED BUG DATA", data);
      if (data.bugs.length) {
        var new_bug = data.bugs[0];
        //console.log('NEW BUG', bug);
        _.each($scope.bugs, function(old_bug, index) {
          if (old_bug.id === new_bug.id) {
            //console.log('Now found the bug');
            new_bug.comments = old_bug.comments;
            new_bug.extract = old_bug.extract;
            new_bug.history = old_bug.history;
            new_bug.unread = old_bug.unread;
            $scope.bugs[index] = new_bug;
          }
        });
        // update the local storage too
        localForage.setItem(bug_id, new_bug);
      }
      if (callback) callback();
    }).error(function(data, status, headers, config) {
      console.warn('Failure to fetchBugs');
      console.log('status', status);
      if (status === 0) $scope.is_offline = true;
      //console.dir(data);
    });
  }

  function fetchComments(id, params) {
    params = params || {};
    if ($scope.auth_token) {
      params.token = $scope.auth_token;
    }
    var url = BUGZILLA_URL + 'bug/' + id + '/comment';
    url += '?' + serializeObject(params);
    //console.log("BUGZILLA URL", url);
    return $http.get(url);
  }

  function makeCommentExtract(comment, max_length) {
    max_length = max_length || 75;
    if (comment.text.length > max_length) {
      return comment.text.substring(0, max_length - 1) + '\u2026';
    }
    return comment.text;
  }


  function fetchAndUpdateComments(bug, callback) {
    fetchComments(bug.id)
      .success(function(data, status, headers, config) {
        //console.log('Comments Success');
        $scope.is_offline = false;
        logDataDownloaded(data);
        if (data.bugs && data.bugs[bug.id]) {
          bug.comments = data.bugs[bug.id].comments;
          if (bug.comments.length) {
            bug.extract = makeCommentExtract(_.last(bug.comments));
          }
          // we also need to update $scope.bugs where a copy of this bug exists
          _.each($scope.bugs, function(list_bug, index) {
            if (list_bug.id === bug.id) {
              $scope.bugs[index] = bug;
            }
          });
          reCountBugsByStatus($scope.bugs);
          localForage.setItem(bug.id, bug);
        } else {
          console.warn("No 'bugs' in data", data);
        }
        if (callback) callback();
      }).error(function(data, status, headers, config) {
        console.warn("Failure to fetchComments");
        if (status === 0) {
          $scope.is_offline = true;
        } else {
          setErrorNotice('Network trouble. Unable to fetch the bug comments.');
        }
        //console.dir(data);
        console.log('status', status);
        //console.log('HEADERS');
        //console.dir(headers);
        //console.log('CONFIG');
        //console.dir(config);
        if (callback) callback();
      });
  }

  function fetchHistory(id, params) {
    params = params || {};
    if ($scope.auth_token) {
      params.token = $scope.auth_token;
    }
    var url = BUGZILLA_URL + 'bug/' + id + '/history';
    url += '?' + serializeObject(params);
    //console.log("BUGZILLA URL", url);
    return $http.get(url);
  }

  function fetchAttachments(id, params) {
    params = params || {};
    if ($scope.auth_token) {
      params.token = $scope.auth_token;
    }
    var url = BUGZILLA_URL + 'bug/' + id + '/attachment';
    url += '?' + serializeObject(params);
    //console.log("BUGZILLA URL", url);
    return $http.get(url);
  }

  function fetchAndUpdateHistory(bug, callback) {
    fetchHistory(bug.id)
      .success(function(data, status, headers, config) {
        //console.log('History Success');
        //console.dir(data.bugs);
        $scope.is_offline = false;
        logDataDownloaded(data);

        _.each(data.bugs, function(bug_history) {
          if (bug_history.id === bug.id) {
            bug.history = bug_history.history;
          }
        });
        // we also need to update $scope.bugs where a copy of this bug exists
        _.each($scope.bugs, function(list_bug, index) {
          if (list_bug.id === bug.id) {
            $scope.bugs[index] = bug;
          }
        });
        localForage.setItem(bug.id, bug);
        if (callback) callback();
      }).error(function(data, status, headers, config) {
        console.warn("Failure to fetchAndUpdateHistory");
        if (status === 0) {
          // timed out, possibly no internet connection
          $scope.is_offline = true;
        } else {
          setErrorNotice('Network trouble. Unable to fetch the bug comments.');
        }
        //console.dir(data);
        console.log('status', status);
        //console.log('HEADERS');
        //console.dir(headers);
        //console.log('CONFIG');
        //console.dir(config);
        if (callback) callback();
      });
  }

  function fetchAndUpdateAttachments(bug, callback) {
    fetchAttachments(bug.id, {include_fields: _ATTACHMENT_INCLUDE_FIELDS})
      .success(function(data, status, headers) {
        $scope.is_offline = false;
        logDataDownloaded(data);
        // we can't just copy the attachment onto the bug and save it because
        // it's potentially too large
        var attachments = [];
        if (data.bugs && data.bugs[bug.id]) {
          _.each(data.bugs[bug.id], function(attachment) {
            if (attachment.is_obsolete) return;
            attachments.push(attachment);
          });
          if (attachments.length) {
            bug.attachments = attachments;
            localForage.setItem(bug.id, bug);
          }
        }
        if (callback) callback();
      }).error(function(data, status) {
        if (status === 0) $scope.is_offline = true;
      });
  }

  function loadProducts() {
    angularForage.getItem($scope, 'products', function(value) {
      if (value && value.length) {
        $scope.products = value;
      }
    });
  }
  loadProducts();


  /* Pulls bugs from local storage and if nothing's there,
   * fetch it remotely */
  function loadBugs(callback) {
    localForage.getItem('bugs', function(value) {
      if (value) {
        console.log("Found", value.length, "bug ids");
        var _bugs_left = value.length;
        _.each(value, function(id, index) {
          localForage.getItem(id, function(bug) {
            // count down
            _bugs_left--;
            if (bug) {
              $scope.bugs.push(bug);
            } else {
              console.warn('No bug data on', id);
              fetchAndUpdateBug(id);
            }
            if (!_bugs_left) {
              // count how many bugs we have comments for
              countBugsWithComments();
              // tally up the bugs by status
              reCountBugsByStatus($scope.bugs);
              // all getItem calls have called back
              $scope.$apply();
              // start pulling down comments pre-emptively
              console.log('Done loading bugs. Start downloading some comments.');
              downloadSomeComments();
              if (callback) callback();
            }
          });
        });
      } else {
        // need to fetch remotely
        if ($scope.products.length) {
          startLoading('Feching bugs');
          console.log("Start fetchAndUpdateBugs()");
          fetchAndUpdateBugs(function() {
            stopLoading();
            // count how many bugs we have comments for
            countBugsWithComments();
            // tally up the bugs by status
            reCountBugsByStatus($scope.bugs);
            $scope.$apply();
            // start pulling down comments pre-emptively
            downloadSomeComments();
            if (callback) callback();
          });
        }
      }
    });
  }

  // the very first thing to do
  angularForage.getItem($scope, 'products', function(value) {
    if (value) {
      // console.log("Stored products", value);
      $scope.products = value;
      showCloakDialog('Loading bugs from local storage...');
      loadBugs(function() {
        localForage.getItem('selected_bug', function(id) {
          if (id) {
            angularForage.getItem($scope, id, function(bug) {
              if (bug) {
                // console.log('selected bug:', bug.id);
                $scope.selectBug(bug);
                //$scope.bug = bug;
              } else {
                console.warn('selected_bug not available');
              }
            });
          }
        });
        precalculateProductCounts();
        closeCloakDialog();
      });
    } else {
      console.warn('No previously stored products');
      closeCloakDialog();
    }
  });


  /* Pulls down the comments for some bugs we haven't already
   * done so for.
   * This basically makes it more prepared so that clicking on
   * a bug you haven't already clicked on already has some of the content.
   * */
  var _downloaded_comments = 0;
  function downloadSomeComments() {
    if (_downloaded_comments > MAX_BACKGROUND_DOWNLOADS) {
      countBugsWithComments();
      countTotalComments();
      stopLoading();
      $timeout(function() {
        _downloaded_comments = 0;
        // recurse
        downloadSomeComments();
      }, 60 * 1000);
      return;  // we've pre-emptively downloaded too much
    }
    //console.log('Hmm... what to download?', _downloaded_comments);

    var _downloading = false;
    // we want to do this to the most recent bugs first
    _.each(_.sortBy($scope.bugs, lastChangeTimeSorter).reverse(), function(bug, index) {
      if (!_downloading && !bug.comments) {
        _downloading = true;
        _downloaded_comments++;
        console.log("FETCH", bug.id);
        startLoading('Fetching comments');
        fetchAndUpdateComments(bug, downloadSomeComments);
      }
    });
    if (!_downloading) {
      // there was nothing more to pre-emptively download
      stopLoading();
    }
  }

  $scope.reDownloadSomeComments = function() {
    console.log('reDownloadSomeComments', _downloaded_comments, MAX_BACKGROUND_DOWNLOADS);
    if (_downloaded_comments > MAX_BACKGROUND_DOWNLOADS) {
      _downloaded_comments = 0;
      // gently increment
      MAX_BACKGROUND_DOWNLOADS = parseInt(MAX_BACKGROUND_DOWNLOADS * 1.5);
      if (MAX_BACKGROUND_DOWNLOADS > 30) {
        // let's not go too crazy
        MAX_BACKGROUND_DOWNLOADS = 30;
      }
    }
    downloadSomeComments();
  };

  // the selected bug
  $scope.bug = {
     empty: true
  };

  var start_updating_comments_timer = null;

  $scope.selectBug = function(bug) {
    // Due to a "bug" in the native REST api, we don't the real_name
    // in the creator of the comment so we make a hash table from all bugs
    // that have it
    if (bug.creator_detail && bug.creator_detail.email && bug.creator_detail.real_name) {
      $scope.email_to_name[bug.creator_detail.email] = bug.creator_detail.real_name;
      localForage.setItem('email_to_name', $scope.email_to_name);
    }
    if (bug.unread) {
      $scope.counts_by_status.UNREAD--;
    }
    if (bug.is_changed) {
      $scope.counts_by_status.CHANGED--;
    }
    $scope.in_config = false; // just in case
    $scope.in_about = false; // just in case
    $scope.in_charts = false; // just in case
    bug.empty = false;
    bug.unread = false;
    bug.is_changed = false;
    localForage.setItem(bug.id, bug);
    localForage.setItem('selected_bug', bug.id);
    bug.things = $scope.getThings(bug);
    if (start_updating_comments_timer) {
      $timeout.cancel(start_updating_comments_timer);
    }
    // the reason we want to have a slight delay before we do this is
    // that the user might possibly be flicking through bugs really
    // quick and if we were to fire off updates on each, it'd make far
    // too much traffic
    start_updating_comments_timer = $timeout(function() {
      console.log("Fetching comments for ", bug.id);
      fetchAndUpdateComments(bug, function() {
        bug.things = $scope.getThings(bug);
        fetchAndUpdateHistory(bug, function() {
          bug.things = $scope.getThings(bug);
          fetchAndUpdateBug(bug);
          fetchAndUpdateAttachments(bug, function() {
            bug.things = $scope.getThings(bug);
          });
        });
      });
    }, 1000);
    $scope.bug = bug;
  };

  $scope.isSelectedBug = function(bug) {
    return bug.id == $scope.bug.id;
  };

  var _gravatar_cache = {};
  $scope.avatarURL = function(email, size) {
    size = size || 64;
    var secure = document.location.protocol === 'https:';
    if (email === 'mozilla+bugcloser@davedash.com') {
      // exceptions
      return 'static/images/bugzilla-icon.png';
    }
    //return 'static/images/avatar.png'; // debugging
    var cache_key = email + size + secure;
    var url = _gravatar_cache[cache_key];
    if (!url) {
      url = get_gravatar(email, size, secure);
      _gravatar_cache[cache_key] = url;
    }
    return url;
  };

  $scope.isEmail = function(text) {
    if (!text) return false;
    return text.match(/@/) && !text.match(/\s/);
  };

  $scope.nameOrEmail = function(email) {
    return $scope.email_to_name[email] || email;
  };

  $scope.displayTimeAgo = function(ts) {
    return moment(ts).fromNow();
  };

  $scope.clearLocalStorage = function() {
    localForage.clear(function() {
      document.location.reload();
      //loadBugs();
    });
  };

  /* Since we store things of the following keys:
   *   'bugs': ['123', '456'],
   *   '123': {object},
   *   '456': {object},
   *   '789': {object}
   * There might thus be things in local storage that aren't
   * referenced in `bugs`.
   * This happens if you, for example, remove a product that
   * you're no longer interested in.
   */
  var more_to_clean = false;
  $scope.cleanLocalStorage = function() {
    cleanLocalStorage({max: 200});  // attempt a much larger set
  };

  function cleanLocalStorage(options, callback) {
    if (_.isFunction(options)) {
      callback = options;
      options = {};
    } else {
      options = options || {};
    }
    // If we kick off a `localForage.key(...)` for each index
    // number there's a risk might cause too much stress on the
    // browser.
    var MAX = options.max || 30;
    localForage.getItem('bugs', function(bug_ids) {
      localForage.length(function(L) {
        _.each(_.sample(_.range(L), MAX), function(idx, count) {
          localForage.key(idx, function(K) {
            if (isAllDigits('' + K)) {
              if (!_.contains(bug_ids, K)) {
                localForage.removeItem(K, function() {
                  console.log("Cleaned up bug", K);
                });
              }
            }
            if ((count + 1) === MAX && callback) {
              $scope.$apply(callback);
            }
          });
        });
      });
    });
  }

  $interval(function() {
    if (!_inprogress_refreshing) {
      L('Runing cleanLocalStorage()');
      cleanLocalStorage();
    }
  }, CLEAN_LOCAL_STORAGE_FREQUENCY * 1000);

  $scope.makeBugzillaLink = function(id, comment_index) {
    return 'https://bugzilla.mozilla.org/show_bug.cgi?id=' + id;
  };

  $scope.makeBugzillaAttachmentLink = function(id) {
    return 'https://bugzilla.mozilla.org/attachment.cgi?id=' + id;
  };

  $scope.makeBugzillaAttachmentReviewLink = function(bug_id, attachment_id) {
     return 'https://bugzilla.mozilla.org/page.cgi?id=splinter.html&bug=' + bug_id + '&attachment=' + attachment_id;
  };

  $scope.showFileSize = function(bytes) {
    return filesize(bytes);
  };

  $scope.refreshBugs = function() {
    console.log('Start refreshing bugs');
    $scope.products_changed = false;
    startLoading('Refreshing bug list');
    _inprogress_refreshing = true;
    fetchAndUpdateBugs(function() {
      stopLoading();
      precalculateProductCounts();
      _inprogress_refreshing = false;
    });
  };

  $scope.refreshBug = function(bug) {
    startLoading('Refreshing bug and its comments');
    fetchAndUpdateBug(bug, function() {
      //console.log('Afterwards bug.status=', bug.status, ' $scope.bug.status=', $scope.bug.status);
      fetchAndUpdateComments(bug, function() {
        bug.things = $scope.getThings(bug);
        fetchAndUpdateHistory(bug, function() {
          bug.things = $scope.getThings(bug);
          fetchAndUpdateAttachments(bug, function() {
            bug.things = $scope.getThings(bug);
            stopLoading();
          });
        });
      });
    });
  };

  $scope.loadMore = function() {
    $scope.list_limit *= 2;
    console.log("Limit to", $scope.list_limit);

    _downloaded_comments = 0;  // reset this so we can load more
    console.log('in loadMore()');
    downloadSomeComments();
  };

  $scope.canLoadMore = function() {
    return $scope.bugs.length > $scope.list_limit;
  };


  $scope.found_products = [];
  function findProductsByEmail(email, callback, error_callback) {
    var params = {
      include_fields: 'product,component',
      assigned_to: email,
      //email1_qa_contact: 1,
      //email1_creator: 1
    };
    fetchBugs(params)
      .success(function(data, status, headers, config) {
        $scope.is_offline = false;
        _.each(data.bugs, function(bug) {
          var combo = bug.product + ' :: ' + bug.component;
          if (!_.contains($scope.found_products, combo)) {
            $scope.found_products.push(combo);
          }
        });
        $timeout(function() {
          $scope.found_products = [];
        }, 60 * 1000);
        if (callback) callback();
      }).error(function(data, status, headers, config) {
        console.warn('Failure to fetchBugs');
        console.log('status', status);
        if (status === 0) $scope.is_offline = true;
        //console.dir(data);
        //setErrorNotice('Remote trouble. Unable to find products & components.');
        if (error_callback) error_callback();
      });
  }

  $scope.removeProduct = function(combo) {
    $scope.products = _.filter($scope.products, function(p) {
      return p !== combo;
    });
    localForage.setItem('products', $scope.products);
    $scope.products_changed = true;
    cleanLocalStorage();
  };

  $scope.searchProductsByEmail = function() {
    if (this.email && this.email.trim()) {
      startLoading('Finding Products & Components');
      findProductsByEmail(this.email, function() {
        stopLoading();
      }, function() {
        // error callback
        stopLoading();
      });
    }
  };

  $scope.addProduct = function() {
    if (!this.product_choice) return;
    _.each(this.product_choice, function(product_choice) {
      console.log("PRODUCT_CHOICE", product_choice);
      if (product_choice.search(/ :: /) == -1) {
        // e.g. "Socorro"
        var start = product_choice + ' :: ';
        _.each($scope.product_choices, function(e) {
          if (e.substring(0, start.length) == start) {
            if (!_.contains($scope.products, e)) {
              $scope.products.push(e);
            }
          }
        });
      } else {
        if (!_.contains($scope.products, product_choice)) {
          $scope.products.push(product_choice);
        }
      }
    });
    localForage.setItem('products', $scope.products);
    $scope.products_changed = true;
    $scope.search_products = '';
  };

  $scope.addProductCombo = function(combo) {
    if (!_.contains($scope.products, combo)) {
      $scope.products.push(combo);
      if (_.contains($scope.found_products, combo)) {
        $scope.found_products = _.filter($scope.found_products, function(c) {
          return c !== combo;
        });
      }
      $scope.products_changed = true;
    }
  };

  var _downloading_configuration = false;  // used to prevent onFocus on fire repeatedly
  $scope.product_choices = ['Be patient. It takes a while to download all options.'];
  $scope.product_choice = null;

  // this is always called in an aync process
  function _downloadConfiguration() {
    startLoading('Downloading all possible Products & Components');
    var params = {
      type: 'accessible',
      include_fields: 'name,components.name'
    };
    fetchConfiguration(params)
      .success(function(data) {
        stopLoading();
        $scope.product_choices = [];
        var all = [];
        _.each(data.products, function(p) {
          all.push(p.name);
          _.each(p.components, function(c) {
            all.push(p.name + ' :: ' + c.name);
            //all.push({product: p.name, component: c.name});
          });
        });
        //all = _.sortBy(all, function(each) {
        //  return each.product;
        //});

        all.sort();
        //console.dir(all);

        localForage.setItem('all_product_choices', all, function() {
          var one_day = new Date().getTime() + 60 * 60 * 24 * 1000;
          localForage.setItem('all_product_choices_expires', one_day);
        });

        $scope.product_choices = all;
      }).error(function() {
        console.warn('Unable to download configuration');
      });
  }

  function startSelectProducts() {
    if (_downloading_configuration) return;
    _downloading_configuration = true;
    localForage.getItem('all_product_choices', function(all_product_choices) {
      if (all_product_choices) {
        // promising but how long has it been stored?
        angularForage.getItem($scope, 'all_product_choices_expires', function(expires) {
          if (expires) {
            // very promising
            var now = new Date().getTime();
            if (now < expires) {
              // excellent!
              $scope.product_choices = all_product_choices;
            } else {
              // it was too old
              _downloadConfiguration();
            }
          } else {
            _downloadConfiguration();
          }
        });
      } else {
        _downloadConfiguration();
      }
    });
  }

  var products_counts = {};
  $scope.countBugsByProduct = function(product_combo) {
    //if ($scope.products_changed) return '??';
    if (typeof products_counts[product_combo] === 'undefined') {
      return '??';
    }
    return products_counts[product_combo];
  };

  function precalculateProductCounts() {
    _.each($scope.products, function(product_combo) {
      var product, component;
      if (product_combo.split('::').length >= 2) {
        var combo = pySplit(product_combo, '::', 1);
        product = combo[0].trim();
        component = combo[1].trim();
      } else {
        product = product_combo.trim();
      }
      var count = 0;
      _.each($scope.bugs, function(bug) {
        if (product === bug.product) {
          if (!component || (component && component === bug.component)) {
            count++;
          }
        }
      });
      products_counts[product_combo] = count;
    });
  }

  $scope.count_bugs_with_comments = 0;
  function countBugsWithComments() {
    var count = 0;
    _.each($scope.bugs, function(bug) {
      if (bug.comments && bug.comments.length) count++;
    });
    $scope.count_bugs_with_comments = count;
  }

  $scope.count_total_comments = 0;
  function countTotalComments() {
    var total_comments = 0;
    _.each($scope.bugs, function(bug) {
      if (_.isArray(bug.comments)) {
        total_comments += bug.comments.length;
      }
    });
    $scope.count_total_comments = total_comments;
  }

  $scope.toggleSearch = function() {
    if (!$scope.in_search) {
      // it will be enabled
      setTimeout(function() {
        document.getElementById('search_q').focus();
      }, 100);
    }
    $scope.in_search = ! $scope.in_search;
  };

  $scope.getAuthCookie = function() {
    var email = this.email;
    var params = {login: email, password: this.password};

    fetchAuthToken(params)
      .success(function(data, status, headers, config) {
        $scope.is_offline = false;
        if (data.token) {
          $scope.auth_token = data.token;
          localForage.setItem('auth_token', $scope.auth_token);
          localForage.setItem('email', email);
        } else if (data.error) {
          setErrorNotice(data.message);
          console.warn('Could not log in');
          console.dir(data);
        } else {
          console.warn("Something unexpected");
          console.dir(data);
        }
      }).error(function(data, status, headers, config) {
        console.warn('Failure to fetchAuthToken');
        if (status === 0) $scope.is_offline = true;
        //console.dir(data);
        console.log('status', status);
      });
  };

  $scope.getThings = function(bug) {
    var things = [];
    _.each(bug.comments, function(comment) {
      things.push({
         time: comment.time,
         comment: comment,
         change: null,
         attachment: null
      });
    });
    _.each(bug.history, function(change) {
      things.push({
         time: change.when,
         comment: null,
         change: change,
         attachment: null
      });
    });
    _.each(bug.attachments || [], function(attachment) {
      things.push({
         time: attachment.creation_time,
         comment: null,
         change: null,
         attachment: attachment
      });
    });

    things = _.sortBy(things, 'time');
    return things;
  };

  var products_creation_times = null;
  function getProductsLatestCreationTimes() {
    if (products_creation_times !== null) {
      return products_creation_times;
    }
    var products = {};
    _.each($scope.bugs, function(bug) {
      if (!products[bug.product]) products[bug.product] = {};
      if (!products[bug.product][bug.component]) {
        products[bug.product][bug.component] = bug.creation_time;
      }
      else if (bug.creation_time > products[bug.product][bug.component]) {
        products[bug.product][bug.component] = bug.creation_time;
      }
    });
    return products;
  }

  $scope.fetchNewBugs = function() {
    //startLoading('Finding new bugs');
    fetchNewBugs(function() {
      //stopLoading();
    });
  };

  function fetchNewBugs(callback) {
    products_creation_times = getProductsLatestCreationTimes();
    //console.dir(products_creation_times);
    var _products_left = $scope.products.length;
    var new_bug_ids = [];
    _.each($scope.products, function(product_combo, index) {
      var params = {
         include_fields: _INCLUDE_FIELDS
      };
      var combo = pySplit(product_combo, '::', 1);
      params.product = combo[0].trim();
      params.component = combo[1].trim();
      if (!products_creation_times[params.product]) {
        _products_left--;
        return;
      }
      if (!products_creation_times[params.product][params.component]) {
        _products_left--;
        return;
      }
      params.creation_time = products_creation_times[params.product][params.component];
      // but first we need to add 1 second
      params.creation_time = moment(params.creation_time).add('s', 1).format('YYYY-MM-DDTHH:mm:ssZ');
      fetchBugs(params)
        .success(function(data, status, headers, config) {
          //console.log('Success');
          $scope.is_offline = false;
          logDataDownloaded(data);
          _products_left--;
          _.each(data.bugs, function(bug, index) {
            products_creation_times[bug.product][bug.component] = bug.creation_time;

            // we must check that we don't already have this bug
            var existing_bug = _.findWhere($scope.bugs, {id: bug.id});
            if (existing_bug) {
              bug.comments = existing_bug.comments;
              bug.extract = existing_bug.extract;
              bug.history = existing_bug.history;
            } else {
              //console.log('NEW BUG'); console.dir(bug);
              bug.unread = true;
              $scope.bugs.push(bug);
              _downloaded_comments = 0;
              new_bug_ids.push(bug.id);
            }
            localForage.setItem(bug.id, bug);
            fetchAndUpdateComments(bug);
          });
          if (!_products_left) {
            //console.log('New bug ids', new_bug_ids);
            if (new_bug_ids.length) {
              localForage.getItem('bugs', function(value) {
                if (value) {
                  _.each(new_bug_ids, function(id) {
                    value.push(id);
                  });
                  localForage.setItem('bugs', value);
                }
              });
              if (new_bug_ids.length === 1)
                setGeneralNotice("1 new bug added");
              else
                setGeneralNotice(new_bug_ids.length + " new bugs added");
              playNewBugsSound();
              reCountBugsByStatus($scope.bugs);
              downloadSomeComments();
            }
            if (callback) {
              callback();
            }
          }
        }).error(function(data, status, headers, config) {
          console.warn('Failure to fetchBugs');
          if (status === 0) $scope.is_offline = true;
          console.log('status', status);
        });

    });

  }

  var new_bugs_interval;
  function startFetchNewBugs() {
    new_bugs_interval = $interval(function() {
      if (!_inprogress_refreshing) {
        //L("Fetch new bugs");
        fetchNewBugs();
      } else {
        L('NOT fetching new bugs (_inprogress_refreshing)');
      }
    }, FETCH_NEW_BUGS_FREQUENCY * 1000);
  }
  startFetchNewBugs();


  function getProductsLatestChangeTimes() {
    var p = {};
    _.each($scope.bugs, function(bug) {
      if (!p[bug.product]) p[bug.product] = {};
      if (!p[bug.product][bug.component]) {
        p[bug.product][bug.component] = bug.last_change_time;
      }
      else if (bug.last_change_time > p[bug.product][bug.component]) {
        p[bug.product][bug.component] = bug.last_change_time;
      }
    });
    return p;
  }

  $scope.fetchNewChanges = function() {
    //startLoading('Finding new bugs');
    fetchNewChanges(function() {
      //stopLoading();
    });
  };
  function fetchNewChanges(callback) {
    var last_change_times = getProductsLatestChangeTimes();
    var _products_left = $scope.products.length;
    _.each($scope.products, function(product_combo, index) {
      var params = {
         include_fields: _INCLUDE_FIELDS
      };
      var combo = pySplit(product_combo, '::', 1);
      params.product = combo[0].trim();
      params.component = combo[1].trim();
      if (!last_change_times[params.product]) {
        _products_left--;
        return;
      }
      if (!last_change_times[params.product][params.component]) {
        _products_left--;
        return;
      }
      params.last_change_time = last_change_times[params.product][params.component];
      // but first we need to add 1 second
      params.last_change_time = moment(params.last_change_time).add('s', 1).format('YYYY-MM-DDTHH:mm:ssZ');
      var changed_bug_ids = [];
      fetchBugs(params)
        .success(function(data, status, headers, config) {
          //console.log('Success');
          $scope.is_offline = false;
          logDataDownloaded(data);
          _products_left--;
          _.each(data.bugs, function(bug, index) {
            //console.log("CHANGED BUG", bug.id);
            var existing_bug = _.findWhere($scope.bugs, {id: bug.id});
            if (existing_bug) {
              changed_bug_ids.push(bug.id);
              bug.comments = existing_bug.comments;
              bug.extract = existing_bug.extract;
              bug.history = existing_bug.history;
              bug.unread = existing_bug.unread;
              bug.is_changed = true;
              localForage.setItem(bug.id, bug);
              // replace it
              _.each($scope.bugs, function(old_bug, index) {
                if (old_bug.id === bug.id) {
                  $scope.bugs[index] = bug;
                }
              });
              // if this was the selected bug, change that too
              if ($scope.bug && $scope.bug.id == bug.id) {
                $scope.bug = bug;
              }
              fetchAndUpdateComments(bug);
            }
          });
          if (!_products_left) {
            if (changed_bug_ids.length == 1)
              setGeneralNotice('1 bug updated.');
            else if (changed_bug_ids.length)
              setGeneralNotice(changed_bug_ids.length + ' bugs updated.');
            if (callback) {
              callback();
            }
          }
        }).error(function(data, status, headers, config) {
          console.warn('Failure to fetchNewChanges');
          if (status === 0) $scope.is_offline = true;
          console.log('status', status);
        });
    });
  }

  var changed_bugs_interval;
  function startFetchNewChanges() {
    changed_bugs_interval = $interval(function() {
      if (!_inprogress_refreshing) {
        //L("Fetch changed bugs");
        fetchNewChanges();
      } else {
        L('NOT fetching new changes (_inprogress_refreshing)');
      }
    }, FETCH_CHANGED_BUGS_FREQUENCY * 1000);
  }
  startFetchNewChanges();

  function playNewBugsSound() {
    if ($scope.play_sounds) {
      new Howl({urls: POP_SOUNDS}).play();
    }
  }

  $scope.filterByProduct = function(product) {
    if (product === 'ALL') {
      $scope.product_filters = [];
    } else if (_.contains($scope.product_filters, product)) {
      $scope.product_filters = _.filter($scope.product_filters, function(s) {
        return s !== product;
      });
    } else if ($scope.product_filters.length === $scope.products.length -1) {
      $scope.product_filters = [];
    } else {
      $scope.product_filters.push(product);
    }
    localForage.setItem('product_filters', $scope.product_filters);
  };

}


/* ListController
 * For the middle pane where you scroll and search bugs.
 */
app.controller('ListController',
               ['$scope', '$timeout', '$location', '$anchorScroll',
                function($scope, $timeout, $location, $anchorScroll) {
  $scope.search_q_primary = '';  // the model used for dumping to search_q
  $scope.search_q = '';  // the variable used for filtering
  $scope.in_search = false;
  $scope.list_limit = 100;
  // $scope.product_filters = [];

  $scope.show_product_filters = false;
  $scope.$watchCollection('product_filters', function() {
    $scope.show_product_filters = false;
  });

  $scope.toggleShowProductFilters = function() {
    if (!$scope.show_product_filters) {
      // about to open it
    }
    $scope.show_product_filters = ! $scope.show_product_filters;
  };

  $scope.isSelectedProductFilter = function(product) {
    return _.contains($scope.product_filters, product);
  };

  $scope.isFilteredProduct = function(bug) {
    if (!$scope.product_filters.length) return true; // ALL is "selected"
    var combo = bug.product + ' :: ' + bug.component;
    return _.contains($scope.product_filters, combo);
  };

  // We don't want to run the expensive filter and highlight too quickly
  // when the user is typing something in. Instead we add a deliberate
  // delay so that it only refreshes 300msec after you stop typing
  var search_q_timeout = null;
  var search_q_temp = '';
  $scope.$watch('search_q_primary', function(value) {
    if (search_q_timeout) $timeout.cancel(search_q_timeout);
    search_q_temp = value;
    search_q_timeout = $timeout(function() {
      $scope.search_q = search_q_temp;
    }, 300);
  });

  var search_q_regex;
  $scope.$watch('search_q', function(value) {
    search_q_regex = new RegExp(escapeRegExp(value), 'i');
  });

  $scope.filterBySearch = function(bug) {
    if (!$scope.search_q) return true;
    return search_q_regex.test(bug.summary) || search_q_regex.test('' + bug.id);
  };

  $scope.submitSearch = function() {
    if ($scope.search_q_primary !== $scope.search_q) {
      $scope.search_q = $scope.search_q_primary;
    }
    if ($scope.search_q) {
      var found_bugs = _.filter($scope.bugs, $scope.isFilteredProduct);
      found_bugs = _.filter(found_bugs, $scope.isFilteredStatus);
      found_bugs = _.filter(found_bugs, $scope.filterBySearch);
      if (found_bugs.length == 1) {
        $scope.selectBug(found_bugs[0]);
        $scope.search_q = $scope.search_q_primary = '';
        $scope.in_search = false;
      }
    }
  };

  $scope.highlightSearch = function(text) {
    text = ('' + text).replace('<', '&lt;').replace('>', '&gt;');
    if (!$scope.search_q) {
      if (_.isNumber(text)) return '' + text;
      return text;
    } else if (_.isNumber(text)) {
      // it's a number!
      text = '' + text;
    }
    _.each(search_q_regex.exec(text), function(match) {
      text = text.replace(match, '<span class="match">' + match + '</span>');
    });
    return text;
  };

  $scope.clearSearch = function() {
    $scope.search_q = '';
    $scope.search_q_primary = '';
    $scope.in_search = false;
  };

  $scope.isFilteredStatus = function(bug) {
    if (!$scope.selected_statuses.length) return true; // ALL is "selected"
    if (_.contains($scope.selected_statuses, 'CHANGED') && _.contains($scope.selected_statuses, 'CHANGED')) {
      if (bug.is_changed || bug.unread) {
        return true;
      }
    }
    if (_.contains($scope.selected_statuses, 'CHANGED')) {
      if (!bug.is_changed) {
        return false;
      } else if ($scope.selected_statuses.length === 1) {
        return true;
      }
    }
    if (_.contains($scope.selected_statuses, 'UNREAD')) {
      if (!bug.unread) {
        return false;
      } else if ($scope.selected_statuses.length === 1) {
        return true;
      }
    }
    if (_.contains($scope.selected_statuses, bug.status)) {
      // a good start
      if ($scope.email && _.contains($scope.selected_statuses, 'ASSIGNED_TO')) {
        // has to be
        return $scope.email == bug.assigned_to;
      }
      return true;
    } else if (_.contains($scope.selected_statuses, 'ASSIGNED_TO') && $scope.selected_statuses.length === 1) {
      // indendent of status, it must be assigned
      return $scope.email == bug.assigned_to;
    }
    return false;
  };


  $scope.countAdditionalComments = function(bug) {
    return bug.comments.length - 1;
  };

  $scope.hasAdditionalComments = function(bug) {
    return bug.comments && bug.comments.length > 1;
  };

  $scope.toId = function(value) {
    // convert the string so it can be used as an ID
    return value.replace(/^[0-9]+/, '').replace(/[^a-z0-9]/gi, '');
  };

  function getCurrentBuglist() {
    // this does what the main `ng-repeat` does in the `id="list"` element
    var bugs = _.filter($scope.bugs, $scope.isFilteredProduct);
    bugs = _.filter(bugs, $scope.isFilteredStatus);
    bugs = _.filter(bugs, $scope.filterBySearch);
    bugs = _.sortBy(bugs, function(item) {
      return item.last_change_time;
    }).reverse();
    return bugs;
  }

  $scope.selectNext = function() {
    var is_next = false;
    var bugs = getCurrentBuglist();
    // if the currently selected bug is not in the list,
    // it's going to be impossible to go to the next,
    // so if that's the case, just select the first one
    if ($scope.bug && !_.find(bugs, function(bug) {
      return bug.id === $scope.bug.id;
    })) {
      is_next = true;
    }
    var previous = null;
    _.each(bugs, function(bug) {
      if (is_next) {
        var hash_to = 'b';
        if (previous) hash_to += previous.id;
        else hash_to += bug.id;
        if ((elm = document.getElementById(hash_to))) elm.scrollIntoView();
        $scope.selectBug(bug);
        is_next = false;
      } else if (bug.id === $scope.bug.id) {
        is_next = true;
      }
      previous = bug;
    });
  };

  $scope.selectPrevious = function() {
    var previous = null;
    var bugs = getCurrentBuglist();
    _.each(bugs, function(bug, i) {
      if (bug.id === $scope.bug.id) {
        if (previous) {
          var hash_to;
          if (i > 2) {
            hash_to = 'b' + bugs[i - 2].id;
            if ((elm = document.getElementById(hash_to))) elm.scrollIntoView();
          } else {
            hash_to = 'b' + previous.id;
            if ((elm = document.getElementById(hash_to))) elm.scrollIntoView();
          }
          // yay! we've found it
          $scope.selectBug(previous);
        }
      } else {
        previous = bug;
      }
    });
  };

}]);



app.directive("scrolling", function () {
  return function(scope, element, attrs) {
    var raw = element[0];
    var innerHeight = window.innerHeight;
    var onScroll = function(e) {
      var rect = raw.getBoundingClientRect();
      var apply = false;
      if (rect.top < -100) {
        // no longer at the top
        if (!scope.show_sticky) {
          scope.show_sticky = true;
          apply = true;
        }
      } else {
        if (scope.show_sticky) {
          scope.show_sticky = false;
          apply = true;
        }
      }
      if ((rect.top + 50) >= 0) {
        if (!scope.at_top) {
          scope.at_top = true;
          scope.at_bottom = false;
          apply = true;
        }
      } else if ((rect.bottom - 50) <= innerHeight) {
        if (!scope.at_bottom) {
          scope.at_top = false;
          scope.at_bottom = true;
          apply = true;
        }
      } else {
        // in the middle
        if (scope.at_top) {
          scope.at_top = false;
          apply = true;
        }
        if (scope.at_bottom) {
          scope.at_bottom = false;
          $apply = true;
        }
      }
      if (apply) scope.$apply();
    };
    angular.element(window).bind('scroll load', onScroll);
  };
});

app.controller('BugController', ['$scope', '$interval', '$http', '$timeout', function($scope, $interval, $http, $timeout) {

  $scope.at_top = true;
  $scope.at_bottom = false;
  $scope.show_sticky = false;

  $scope.isAssignedTo = function(bug) {
    return bug.assigned_to && bug.assigned_to != 'nobody@mozilla.org';
  };

  $scope.gotoTop = function() {
    if (elm = document.getElementById('top')) elm.scrollIntoView();
  };
  $scope.gotoBottom = function() {
    if (elm = document.getElementById('bottom')) elm.scrollIntoView();
  };

  $scope.changeable_statuses = ['CONFIRMED', 'RESOLVED'];
  $scope.changeable_resolutions = [];
  $scope.$watch('bug', function(bug) {
    //console.log("Changed to", bug.status);
    if (bug.status === 'NEW') {
      $scope.changeable_statuses = ['UNCONFIRMED', 'ASSIGNED', 'RESOLVED'];
    } else if (bug.status === 'UNCONFIRMED') {
      $scope.changeable_statuses = ['NEW', 'ASSIGNED', 'RESOLVED'];
    } else if (bug.status === 'ASSIGNED') {
      $scope.changeable_statuses = ['UNCONFIRMED', 'NEW', 'RESOLVED'];
    } else if (bug.status === 'REOPENED') {
      $scope.changeable_statuses = ['UNCONFIRMED', 'NEW', 'ASSIGNED', 'RESOLVED'];
    } else if (bug.status === 'RESOLVED') {
      $scope.changeable_statuses = ['UNCONFIRMED', 'REOPENED', 'VERIFIED'];
    } else if (bug.status === 'VERIFIED') {
      $scope.changeable_statuses = ['UNCONFIRMED', 'REOPENED', 'RESOLVED'];
    }
    $scope.status = 'Leave as ' + bug.status;
    $scope.changeable_statuses.unshift('Leave as ' + bug.status);

  });
  $scope.$watch('status', function(status) {
    if (status === 'RESOLVED' || status === 'VERIFIED') {
      $scope.resolution = 'FIXED';  // the default
      $scope.changeable_resolutions = ['FIXED', 'INVALID', 'WONTFIX', 'DUPLICATE', 'WORKSFORME', 'INCOMPLETE'];
    } else {
      $scope.changeable_resolutions = [];
    }
  });

  $scope.post_queue = {};
  angularForage.getItem($scope, 'post_queue', function(value) {
    if (value !== null) {
      $scope.post_queue = clearEmptyBugs(value);
    }
  });

  $scope.cancelPost = function(bug_id, _when) {
    $scope.post_queue[bug_id] = _.filter($scope.post_queue[bug_id], function(p) {
      return p._when !== _when;
    });
  };

  $scope.submitUpdate = function() {
    //console.log('$scope.post_queue', $scope.post_queue);
    //console.log('this.comment', this.comment, '$scope.comment', $scope.comment);
    var comment = this.comment || '';
    var status = this.status || '';
    var resolution = this.resolution || '';
    if (status.substring(0, 'Leave as '.length) === 'Leave as ') {
      status = '';
      resolution = '';
    }
    if (!status) {
      if (!comment.trim()) {
        return;
      }
    }
    var post = {
      'comment': comment,
      'status': status,
      'resolution': resolution,
      '_when': new Date()
    };
    var bug_id = $scope.bug.id;
    if (!$scope.post_queue[bug_id]) {
      $scope.post_queue[bug_id] = [];
    }
    $scope.post_queue[bug_id].push(post);
    angularForage.setItem($scope, 'post_queue', $scope.post_queue, function() {
      $scope.comment = '';
      $scope.status = 'Leave as ' + $scope.bug.status;
      $scope.resolution = '';
      if (!_lock_post_queue) {
        _lock_post_queue = true;
        clearPostQueue(function() {
          _lock_post_queue = false;
        });
      }
    });
  };

  function postComment(bug_id, params) {
    if ($scope.auth_token) {
      params.token = $scope.auth_token;
    }
    var url = BUGZILLA_URL + 'bug/' + bug_id + '/comment';
    // var url = 'http://localhost:8888/' + 'bug/' + bug_id + '/comment';
    if (params.id !== bug_id) {
      params.id = bug_id;
    }
    // console.log("BUGZILLA URL", url);
    return $http.post(url, params);
  }

  function putUpdate(bug_id, params) {
    if ($scope.auth_token) {
      params.token = $scope.auth_token;
    }
    var url = BUGZILLA_URL + 'bug/' + bug_id;
    //var url = 'http://localhost:8888/' + 'bug/' + bug_id;
    if (!params.ids || (params.ids && !_.contains(params.ids, bug_id))) {
      params.ids = [bug_id];
    }
    //console.log("BUGZILLA URL", url);
    return $http.put(url, params);
  }

  var _lock_post_queue = false;
  function clearPostQueue(callback) {
    //console.log('Clearing', $scope.post_queue);
    // we first need to count how many posts we need to do
    // '$scope.post_queue' is an object so to get a count of it we need to
    // use an iterator
    var count_bugs = 0;
    _.each($scope.post_queue, function(arr) {
      if (arr.length) {
        count_bugs++;
      }
    });
    var original_count_bugs = count_bugs;
    var params;
    _.each($scope.post_queue, function(posts, bug_id, index) {
      count_bugs--;
      var count_posts = posts.length;
      _.each(posts, function(post) {
        //console.log('THING TO POST', post);

        // we need to keep track of how many things we have to do
        // so we know when to execute a callback
        var things_to_do = 0;
        if (post.status) things_to_do++;
        if (post.comment) things_to_do++;
        //L('things_to_do', things_to_do);

        if (post.status) {
          params = {
            'ids': [bug_id],
            'status': post.status,
            'resolution': post.resolution
          };
          putUpdate(bug_id, params)
            .success(function(data, status) {
              console.log('YAY! PUT WORKED');
              console.log(data);

              $scope.is_offline = false;
              $scope.post_queue[bug_id] = _.filter($scope.post_queue[bug_id], function(p) {
                return p._when !== post._when;
              });
              if ($scope.bug.id === parseInt(bug_id)) {
                // this is the currently chosen bug
                $scope.refreshBug($scope.bug);
              }
            }).error(function(data, status) {
              console.warn('Unable to put update', data);
              if (status === 0) $scope.is_offline = true;
            }).finally(function() {
              count_posts--;
              things_to_do--;
              if (!things_to_do && count_posts <= 0 && !count_bugs) {
                // console.log('Finally callback after putUpdate');
                localForage.setItem('post_queue', $scope.post_queue);
                if (callback) callback();
              }
            });
        }

        if (post.comment) {
          params = {
            'id': bug_id,
            'comment': post.comment,
          };

          postComment(bug_id, params)
            .success(function(data, status) {
              $scope.is_offline = false;
              if (data.error)  {
                console.warn("Actually unable to post comment", data);
                $scope.post_queue[bug_id] = _.map($scope.post_queue[bug_id], function(p) {
                  if (p._when === post._when) {
                    p._error = data;
                  }
                  return p;
                });
              } else {
                console.log('YAY! POST COMMENT WORKED');
                console.log(data);

                $scope.post_queue[bug_id] = _.filter($scope.post_queue[bug_id], function(p) {
                  return p._when !== post._when;
                });
                if ($scope.bug.id === parseInt(bug_id)) {
                  // this is the currently chosen bug
                  $scope.refreshBug($scope.bug);
                }
              }
            }).error(function(data, status) {
              console.warn('Unable to post comment', data);
              console.warn(status);
              //post._error = data;
              $scope.post_queue[bug_id] = _.map($scope.post_queue[bug_id], function(p) {
                if (p._when === post._when) {
                  p._error = data;
                }
                return p;
              });
              //$scope.post_queue[bug_id].push(post);
              if (status === 0) $scope.is_offline = true;
            }).finally(function() {
              count_posts--;
              things_to_do--;
              if (!things_to_do && count_posts <= 0 && !count_bugs) {
                // console.log('Finally callback after postComment');
                localForage.setItem('post_queue', $scope.post_queue);
                if (callback) callback();
              }
            });
        }
      });
    });
    if (!original_count_bugs && callback) {
      // console.log('Callback immediately');
      callback();
    }
  }

  function clearEmptyBugs(post_queue) {
    var new_post_queue = {};
    _.each(post_queue, function(posts, bug_id) {
      if (posts.length) {
        new_post_queue[bug_id] = posts;
      }
    });
    return new_post_queue;
  }

  $scope.getBugPostQueue = function(bug_id) {
    return $scope.post_queue[bug_id] || [];
  };

  $interval(function() {
    if (!_lock_post_queue) {
      _lock_post_queue = true;
      clearPostQueue(function() {
        _lock_post_queue = false;
      });
    } else {
      console.warn("clear post queue is locked");
    }
  }, CLEAR_POST_QUEUE_FREQUENCY * 1000);

}]);


app.controller('ConfigController', ['$scope', function($scope) {

  $scope.clearAuthToken = function() {
    $scope.auth_token = null;
    localForage.removeItem('auth_token');
  };

  $scope.togglePlaySounds = function() {
    $scope.play_sounds = ! $scope.play_sounds;
    localForage.setItem('play_sounds', $scope.play_sounds);
    return false;
  };

  $scope.searching_products = false;
  $scope.search_products = '';
  $scope.isFoundProductChoice = function(combo) {
    if (!$scope.search_products.length) return true;
    var found_match = true;
    _.each($scope.search_products.trim().split(' '), function(part) {
      if (combo.match(new RegExp('\\b' + escapeRegExp(part), 'i')) === null) {
        found_match = false;
      }
    });
    return found_match;
  };

  $scope.highlightProductSearch = function(text) {
    if (!$scope.search_products) return text;
    _.each($scope.search_products.trim().split(' '), function(part) {
      var regex = new RegExp('\\b' + escapeRegExp(part), 'i');
      _.each(regex.exec(text), function(match) {
        text = text.replace(match, '<span class="match">' + match + '</span>');
      });
    });
    return text;
  };

}]);  // end ConfigController


app.controller('ChartsController', ['$scope', function($scope) {

  function getChartData() {
    var statuses = {};
    // we're only interested in some products
    var any = {};
    var only_product_combos = $scope.products;
    if ($scope.product_filters.length) {
      only_product_combos = $scope.product_filters;
    }

    var grouping = $scope.number_bugs_charts_group;
    _.each($scope.bugs, function(bug) {
      var status = bug.status;
      if (grouping === 'simple') {
        if (_.contains(['UNCONFIRMED', 'NEW', 'ASSIGNED', 'REOPENED'], status)) {
          status = 'OPEN';
        } else {
          status = 'CLOSED';
        }
      }
      var bucket = statuses[status] || {};
      var combo = bug.product + ' :: ' + bug.component;
      if (!_.contains(only_product_combos, combo)) return;
      any[status] = 1;
      var count = bucket[combo] || 0;
      bucket[combo] = count + 1;
      statuses[status] = bucket;
    });
    var status_keys = ['UNCONFIRMED', 'NEW', 'ASSIGNED', 'REOPENED', 'RESOLVED', 'VERIFIED', 'CLOSED'];
    if (grouping === 'simple') {
      status_keys = ['OPEN', 'CLOSED'];
    } else {
      status_keys = _.filter(status_keys, function(k) {
        return any[k];
      });
    }
    var values = _.map(status_keys, function(status) {
      var bucket = statuses[status];
      if (typeof bucket === 'undefined') bucket = {};
      var vs = _.map(only_product_combos, function(combo) {
        return {x: combo, y: bucket[combo] || 0};
      });
      return {
        key: status,
        values: vs
      };
    });
    return values;
  }
  function drawChart() {
    nv.addGraph(function() {
      //var chart = nv.models.discreteBarChart()
      var chart = nv.models.multiBarChart()
          //.x(function(d) { return d.label })    //Specify the data accessors.
          //.y(function(d) { return d.value })
          //.x(function(d) { return d.label })    //Specify the data accessors.
          //.y(function(d) { return d.value })
          .staggerLabels(true)    //Too many bars and not enough room? Try staggering labels.
          .tooltips(true)        //Don't show tooltips
          //.showValues(true)       //...instead, show the bar value right on top of each bar.
          .transitionDuration(100)
          .stacked(true)
          ;
      chart.yAxis
                .tickFormat(d3.format(',f'));
      d3.select('#number_bugs_chart svg')
          .datum(getChartData())
          .call(chart);
      nv.utils.windowResize(chart.update);
      return chart;
    });
  }
  $scope.$watch('in_charts', function(value) {
    if (value) {
      drawChart();
    }
  });
  $scope.number_bugs_charts_group = 'all';
  $scope.$watch('number_bugs_charts_group', drawChart);
  $scope.$watchCollection('product_filters', drawChart);

}]);  // end ChartsController

// for debugging purposes only
function forgetBug(id) {
  localForage.removeItem(id, function() {
    localForage.getItem('bugs', function(v) {
      v = _.filter(v, function(x) { return x != id; });
      localForage.setItem('bugs', v, function() {
        alert("removed " + id);
      });
    });
  });
}
function markUnread(id) {
  localForage.getItem(id, function(bug) {
    bug.unread = true;
    localForage.setItem(id, bug, function() {
      alert('Done! Reload');
    });
  });
}
