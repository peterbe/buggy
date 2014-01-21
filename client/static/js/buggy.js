/*global: get_gravatar, serializeObject, filesize, document */

'use strict';

// saves typing
var L = function() { console.log.apply(console, arguments) };
var D = function() { console.dir.apply(console, arguments) };

var BUGZILLA_URL = 'https://bugzilla.mozilla.org/rest/';
var MAX_BACKGROUND_DOWNLOADS = 10;
var FETCH_NEW_BUGS_FREQUENCY = 25;
var FETCH_CHANGED_BUGS_FREQUENCY = 30;
var CLEAN_LOCAL_STORAGE_FREQUENCY = 120;

var _INCLUDE_FIELDS = 'assigned_to,assigned_to_detail,product,component,creator,creator_detail,status,id,resolution,last_change_time,creation_time,summary';
var _ALL_POSSIBLE_STATUSES = 'UNCONFIRMED,NEW,ASSIGNED,REOPENED,RESOLVED,VERIFIED,CLOSED'.split(',');
// utils stuff
function makeCommentExtract(comment, max_length) {
  max_length = max_length || 75;
  if (comment.text.length > max_length) {
    return comment.text.substring(0, max_length - 1) + '\u2026';
  }
  return comment.text;
}

var app = angular.module('buggyApp', ['ngSanitize']);

app.filter('stringArraySort', function() {
  return function(input) {
    return input.sort();
  }
});

app.directive('whenScrolled', function() {
  return function(scope, elm, attr) {
    var raw = elm[0];
    var funCheckBounds = function(evt) {
      //console.log("event fired: " + evt.type);
      var rectObject = raw.getBoundingClientRect();
      //console.log(rectObject.bottom, window.innerHeight);
      if (rectObject.bottom < window.innerHeight) {
        //console.log('**At the bottom');
        scope.$apply(attr.whenScrolled);
      }

    };
    angular.element(window).bind('scroll load', funCheckBounds);
  };
});


BugsController.$inject = ['$scope', '$timeout', '$http', '$interval'];

function BugsController($scope, $timeout, $http, $interval) {
  var _inprogress_refreshing = false;

  $scope.bugs = [];
  $scope.in_config = false;
  $scope.in_about = false;
  $scope.email = '';
  $scope.auth_token = null;
  $scope.is_offline = false;
  $scope.all_possible_statuses = _ALL_POSSIBLE_STATUSES;
  $scope.selected_statuses = [];
  angularForage.getItem($scope, 'selected_statuses', function(value) {
    if (value != null) {
      $scope.selected_statuses = value;
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
    if (value != null) $scope.play_sounds = value;
  });

  $scope.config_stats = {
     data_downloaded_human: '',
     total_data_downloaded_human: '',
     total_comments: 0
  };

  $scope.data_downloaded = 0;  // this session
  $scope.total_data_downloaded = 0; // persistent with local storage
  angularForage.getItem($scope, 'total_data_downloaded', function(value) {
    if (value != null) {
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
  var original_document_title = document.title;
  $scope.loading = null;
  function startLoading(msg) {
    $scope.loading = {message: msg};
    document.title = msg;
  }
  function stopLoading() {
    $scope.loading = null;
    document.title = original_document_title;
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

  $scope.general_notice = null;
  function setGeneralNotice(msg, options) {
    options = options || {};
    var delay = options.delay || 5;
    $scope.general_notice = msg;
    $timeout(function() {
      $scope.general_notice = null;
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
    if (status === 'ALL') {
      return counts_by_status.ALL;;
    } else if (status === 'ASSIGNED_TO') {
      return counts_by_status.ASSIGNED_TO;
    } else {
      return counts_by_status[status] || 0;
    }
  };

  var counts_by_status = {};
  function reCountBugsByStatus(bugs) {
    if (!bugs) return;
    counts_by_status.ALL = bugs.length;
    counts_by_status.ASSIGNED_TO = 0;
    _.each(bugs, function(bug) {
      if ($scope.email == bug.assigned_to) {
        counts_by_status.ASSIGNED_TO++;
      }
      counts_by_status[bug.status] = 1 + (counts_by_status[bug.status] || 0);
    });
    console.log('BUGS ARE A CHANGING');
    console.log(counts_by_status);
  };

  $scope.$watch('bugs', reCountBugsByStatus);

  $scope.toggleConfig = function() {
    if (!$scope.in_config) {
      // before opening the config pane, preload some stats
      $scope.config_stats.total_bugs = $scope.bugs.length;
      $scope.config_stats.data_downloaded_human = filesize($scope.data_downloaded);
      $scope.config_stats.total_data_downloaded_human = filesize($scope.total_data_downloaded);
      countTotalComments();
      precalculateProductCounts();
    }
    $scope.in_config = ! $scope.in_config;
  };

  $scope.toggleAbout = function() {
    $scope.in_about = ! $scope.in_about;
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
  //$scope.lastChangeTimeSorter = lastChangeTimeSorter;
//  $scope.lastChangeTimeSorter = function(bug) {
//    return bug.last_change_time;
//  }

  function fetchAndUpdateBugs(callback) {
    var _products_left = $scope.products.length;
    var bug_ids = [];
    $scope.bugs = [];
    _.each($scope.products, function(product_combo, index) {
      var params = {
         include_fields: _INCLUDE_FIELDS
      };
      //if (product_combo.split('::').length === 2) {
        params.product = product_combo.split('::')[0].trim();
        params.component = product_combo.split('::')[1].trim();
      //} else {
      //  params.product = product_combo.trim();
      //}
      fetchBugs(params)
        .success(function(data, status, headers, config) {
          console.log('Success');
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
              if (existing_bug != null) {
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
                reCountBugsByStatus();
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
      include_fields: _INCLUDE_FIELDS
    }).success(function(data, status, headers, config) {
      console.log('Success');
      $scope.is_offline = false;
      logDataDownloaded(data);
        //console.dir(data);
      if (data.bugs.length) {
        var bug = data.bugs[0];
        _.each($scope.bugs, function(old_bug, index) {
          if (old_bug.id === bug.id) {
            $scope.bugs[index] = bug;
          }
        });
        // update the local storage too
        localForage.setItem(bug.id, bug);
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

  function fetchAndUpdateComments(bug, callback) {
    fetchComments(bug.id)
      .success(function(data, status, headers, config) {
        //console.log('Comments Success');
        $scope.is_offline = false;
        logDataDownloaded(data);
        //console.dir(data);
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

        localForage.setItem(bug.id, bug);
        if (callback) callback();
      }).error(function(data, status, headers, config) {
        console.warn("Failure to fetchComments");
        if (status === 0) {
          $scope.is_offline = true;
        } else {
          setErrorNotice('Remote trouble. Unable to fetch the bug comments.');
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
          $sope.is_offline = true;
        } else {
          setErrorNotice('Remote trouble. Unable to fetch the bug comments.');
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

  function loadProducts() {
    angularForage.getItem($scope, 'products', function(value) {
      if (value != null && value.length) {
        $scope.products = value;
      }
    });
  }
  loadProducts();


  /* Pulls bugs from local storage and if nothing's there,
   * fetch it remotely */
  function loadBugs(callback) {
    localForage.getItem('bugs', function(value) {
      if (value != null) {
        console.log("Found", value.length, "bug ids");
        var _bugs_left = value.length;
        _.each(value, function(id, index) {
          localForage.getItem(id, function(bug) {
            // count down
            _bugs_left--;
            if (bug != null) {
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
            // start pulling down comments pre-emptively
            downloadSomeComments();
            if (callback) callback();
          });
        }
      }
    });
  };

  // the very first thing to do
  angularForage.getItem($scope, 'products', function(value) {
    if (value != null) {
      console.log("Stored products", value);
      $scope.products = value;
      loadBugs(function() {
        localForage.getItem('selected_bug', function(id) {
          if (id) {
            angularForage.getItem($scope, id, function(bug) {
              if (bug) {
                console.log('selected bug:', bug.id);
                $scope.bug = bug;
              } else {
                console.warn('selected_bug not available');
              }
            });
          }
        });
      });
    } else {
      console.warn('No previously stored products');
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
      if (!_downloading && bug.comments == null) {
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

  $scope.selectBug = function(bug) {
    $scope.in_config = false; // in case
    bug.empty = false;
    bug.unread = false;
    bug.is_changed = false;
    localForage.setItem(bug.id, bug);
    localForage.setItem('selected_bug', bug.id);
    bug.things = $scope.getThings(bug);
    fetchAndUpdateComments(bug, function() {
      bug.things = $scope.getThings(bug);
      fetchAndUpdateHistory(bug, function() {
        bug.things = $scope.getThings(bug);
      });
    });
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

  $scope.displayTimeAgo = function(ts) {
    return moment(ts).fromNow();
  };

  $scope.clearLocalStorage = function() {
    localForage.clear(function() {
      location.reload();
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
      fetchAndUpdateComments(bug, function() {
        $scope.bug = bug;
        stopLoading();
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

  function findProductsByEmail(email, callback) {
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
          if (!_.contains($scope.products, combo)) {
            $scope.products.push(combo);
          }
        });
        if (callback) callback();
      }).error(function(data, status, headers, config) {
        console.warn('Failure to fetchBugs');
        console.log('status', status);
        if (status === 0) $scope.is_offline = true;
        //console.dir(data);
        //setErrorNotice('Remote trouble. Unable to find products & components.');
        if (callback) callback();
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
        if ($scope.products.length) {
          localForage.setItem('products', $scope.products);
          $scope.products_changed = true;
        }
      });
    }
  };

  $scope.listScrolled = function() {
    if (_downloaded_comments) {
      _downloaded_comments = 0;
      downloadSomeComments();
    }
  };

  $scope.addProduct = function() {
    if (!this.product_choice) return;
    if (this.product_choice.search(/ :: /) == -1) {
      // e.g. "Socorro"
      var start = this.product_choice + ' :: ';
      _.each($scope.product_choices, function(e) {
        if (e.substring(0, start.length) == start) {
          if (!_.contains($scope.products, e)) {
            $scope.products.push(e);
          }
        }
      });
    } else {
      if (!_.contains($scope.products, this.product_choice)) {
        $scope.products.push(this.product_choice);
      }
    }
    localForage.setItem('products', $scope.products);
    $scope.products_changed = true;
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

  $scope.startSelectProducts = function() {
    if (_downloading_configuration) return;
    _downloading_configuration = true;
    localForage.getItem('all_product_choices', function(all_product_choices) {
      if (all_product_choices != null) {
        // promising but how long has it been stored?
        angularForage.getItem($scope, 'all_product_choices_expires', function(expires) {
          if (expires != null) {
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

  };

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
      if (product_combo.split('::').length === 2) {
        product = product_combo.split('::')[0].trim();
        component = product_combo.split('::')[1].trim();
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
      if (bug.comments != null) count++;
    });
    $scope.count_bugs_with_comments = count;
  };

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
    things = _.sortBy(things, 'time');
    return things;
  };

  var products_creation_times = null;
  function getProductsLatestCreationTimes() {
    if (products_creation_times != null) {
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
      params.product = product_combo.split('::')[0].trim();
      params.component = product_combo.split('::')[1].trim();
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
          });
          if (!_products_left) {
            //console.log('New bug ids', new_bug_ids);
            if (new_bug_ids.length) {
              localForage.getItem('bugs', function(value) {
                if (value != null) {
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
      params.product = product_combo.split('::')[0].trim();
      params.component = product_combo.split('::')[1].trim();
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

}


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


/* ListController
 * For the middle pane where you scroll and search bugs.
 */
app.controller('ListController', ['$scope', '$timeout', function($scope, $timeout) {

  $scope.search_q_primary = '';  // the model used for dumping to search_q
  $scope.search_q = '';  // the variable used for filtering
  $scope.in_search = false;
  $scope.list_limit = 100;

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
    }, 400);
  });

  $scope.filterBySearch = function(bug) {
    if (!$scope.search_q) return true;
    if (isAllDigits($scope.search_q) &&
        ('' + bug.id).substring(0, $scope.search_q.length) === $scope.search_q
       ) {
      return true;
    }
    var regex = new RegExp($scope.search_q, 'i');
    return regex.test(bug.summary);
  };

  $scope.submitSearch = function() {
    if ($scope.search_q_primary !== $scope.search_q) {
      $scope.search_q = $scope.search_q_primary;
    }
    if ($scope.search_q) {
      var found_bugs = _.filter($scope.bugs, $scope.filterBySearch);
      if (found_bugs.length == 1) {
        $scope.bug = found_bugs[0];
        $scope.search_q = '';
        $scope.in_search = false;
      }
    }
  };

  $scope.highlightSearch = function(text) {
    if (!$scope.search_q) {
      if (_.isNumber(text)) return '' + text;
      return text;
    } else if (_.isNumber(text)) {
      // it's a number!
      text = '' + text;
    }
    var regex = new RegExp($scope.search_q, 'i');
    _.each(regex.exec(text), function(match) {
      text = text.replace(match, '<span class="match">' + match + '</span>');
    });
    return text;
  }

  $scope.clearSearch = function() {
    $scope.search_q = '';
    $scope.search_q_primary = '';
    $scope.in_search = false;
  };

  $scope.isFilteredStatus = function(bug) {
    if (!$scope.selected_statuses.length) return true; // ALL is "selected"
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
    return bug.comments != null && bug.comments.length > 1;
  };

}]);



app.directive("scrolling", function () {
  return function(scope, element, attrs) {
    var raw = element[0];
    var innerHeight = window.innerHeight;
    var onScroll = function(e) {
      //L("Scrolled!");
      var rect = raw.getBoundingClientRect();
      if ((rect.top + 50) >= 0) {
        if (!scope.at_top) {
          //L('AT TOP');
          scope.at_top = true;
          scope.at_bottom = false;
          scope.$apply();
        }
      } else if ((rect.bottom - 50) <= innerHeight) {
        if (!scope.at_bottom) {
          //L('AT BOTTOM');
          scope.at_top = false;
          scope.at_bottom = true;
          scope.$apply();
        }
      } else {
        // in the middle
        if (scope.at_top) {
          scope.at_top = false;
          scope.$apply();
        }
        if (scope.at_bottom) {
          scope.at_bottom = false;
          scope.$apply();
        }
      }
      //L(rect.bottom, innerHeight);
    };
    angular.element(window).bind('scroll load', onScroll);
  };
});

app.controller('BugController', ['$scope', function($scope) {

  // TODO maybe these should depend on window.location.hash
  $scope.at_top = true;
  $scope.at_bottom = false;

  $scope.show_history = false;
  angularForage.getItem($scope, 'show_history', function(value) {
    if (value != null) {
      $scope.show_history = value;
    }
  });
  $scope.toggleShowHistory = function() {
    $scope.show_history = !$scope.show_history;
    localForage.setItem('show_history', $scope.show_history);
  };

  $scope.isAssignedTo = function(bug) {
    return bug.assigned_to && bug.assigned_to != 'nobody@mozilla.org';
  };


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

}]);
