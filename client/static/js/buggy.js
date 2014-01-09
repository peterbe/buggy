/*global: get_gravatar, serializeObject, filesize */

'use strict';





var OLD_BUGZILLA_URL = 'https://api-dev.bugzilla.mozilla.org/1.3/';
var BUGZILLA_URL = 'https://bugzilla.mozilla.org/rest/';
var MAX_BACKGROUND_DOWNLOADS = 3;//10;

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

BugsController.$inject = ['$scope', '$timeout', '$http'];

function BugsController($scope, $timeout, $http) {

  $scope.bugs = [];
  $scope.list_limit = 100;
  $scope.search_q = '';
  $scope.in_search = false;
  $scope.in_config = false;
  $scope.email = '';
  $scope.data_downloaded = 0;
  $scope.all_possible_statuses = _ALL_POSSIBLE_STATUSES;
  $scope.selected_statuses = [];
  angularForage.getItem($scope, 'selected_statuses', function(value) {
    if (value != null) {
      $scope.selected_statuses = value;
    }
  });
  $scope.products = [];

  $scope.errors = {
    update_comments: false,
    finding_products: false
  };

  $scope.config_stats = {
     data_downloaded_human: '',
     total_comments: 0

  };

  /* Used to put a notice loading message on the screen */
  $scope.loading = null;
  function startLoading(msg) {
    $scope.loading = {message: msg};
  }
  function stopLoading() {
    $scope.loading = null;
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

  $scope.isFilteredStatus = function(bug) {
    if (!$scope.selected_statuses.length) return true;
    if ($scope.email && _.contains($scope.selected_statuses, 'ASSIGNED_TO') && $scope.email == bug.assigned_to) {
      return true;
    }
    return _.contains($scope.selected_statuses, bug.status);
  };

  $scope.filterBySearch = function(bug) {
    if (!$scope.search_q) return true;
    if (isAllDigits($scope.search_q)) {
      return ('' + bug.id).substring(0, $scope.search_q.length) === $scope.search_q;
    } else {
      var regex = new RegExp($scope.search_q, 'i');
      return regex.test(bug.summary);
    }
    return false;
  };

  $scope.submitSearch = function() {
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
    if (!$scope.search_q) return text;
    var regex = new RegExp($scope.search_q, 'i');
    _.each(regex.exec(text), function(match) {
      text = text.replace(match, '<span class="match">' + match + '</span>');
    });
    return text;

  }

  $scope.countByStatus = function(status) {
    if (status === 'ALL') {
      return $scope.bugs.length;
    } else if (status === 'ASSIGNED_TO') {
      var count = 0;
      _.each($scope.bugs, function(bug) {
        if (bug.assigned_to == $scope.email) count++;
      });
      return count;
    } else {
      var count = 0;
      _.each($scope.bugs, function(bug) {
        if (bug.status === status) count++;
      });
      return count;
    }
  };

  $scope.toggleConfig = function() {
    if (!$scope.in_config) {
      // before opening the config pane, preload some stats

      $scope.config_stats.total_bugs = $scope.bugs.length;
      $scope.config_stats.data_downloaded_human = filesize($scope.data_downloaded);
      console.log("BEFORE", $scope.count_total_comments);
      countTotalComments();
      console.log("AFTER", $scope.count_total_comments);
      precalculateProductCounts();
    }
    $scope.in_config = ! $scope.in_config;
  };

  function fetchBugs(params) {
    var url = BUGZILLA_URL + 'bug';
    url += '?' + serializeObject(params);
    console.log("BUGZILLA URL", url);
    return $http.get(url);
  }

  function fetchConfiguration(params) {
    var url = OLD_BUGZILLA_URL + 'configuration';
    //url += '?' + serializeObject(params);
    console.log("BUGZILLA URL", url);
    return $http.get(url);
  }

  function lastChangeTimeSorter(bug) {
    return bug.last_change_time;
  }
  //$scope.lastChangeTimeSorter = lastChangeTimeSorter;
  $scope.lastChangeTimeSorter = function(bug) {
    return bug.last_change_time;
  }

  function fetchAndUpdateBugs(callback) {
    var _products_left = $scope.products.length;
    var bug_ids = [];
    $scope.bugs = [];
    _.each($scope.products, function(product_combo, index) {
      var params = {
         include_fields: _INCLUDE_FIELDS
      };
      if (product_combo.split('::').length === 2) {
        params.product = product_combo.split('::')[0].trim();
        params.component = product_combo.split('::')[1].trim();
      } else {
        params.product = product_combo.trim();
      }
      fetchBugs(params)
        .success(function(data, status, headers, config) {
          console.log('Success');
          //console.dir(data);
          $scope.data_downloaded += JSON.stringify(data).length;
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
                $scope.$apply();
                if (callback) {
                  $scope.$apply(callback);
                }
              }
            });
          });
        }).error(function(data, status, headers, config) {
          console.warn('Failure');
          console.dir(data);
        });
    });
  }


  function fetchAndUpdateBug(bug, callback) {
    fetchBugs({
       id: bug.id,
      include_fields: _INCLUDE_FIELDS
    }).success(function(data, status, headers, config) {
      console.log('Success');
      $scope.data_downloaded += JSON.stringify(data).length;
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
      console.warn('Failure to update bug');
      console.dir(data);
    });
  }

  function fetchComments(id, params) {
    params = params || {};
    var url = BUGZILLA_URL + 'bug/' + id + '/comment';
    url += '?' + serializeObject(params);
    console.log("BUGZILLA URL", url);
    return $http.get(url);
  }

  function fetchAndUpdateComments(bug, callback) {
    fetchComments(bug.id)
      .success(function(data, status, headers, config) {
        //console.log('Comments Success');
        $scope.data_downloaded += JSON.stringify(data).length;
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
        console.warn("Failure to update bugs' comments");
        if (status === 0) {
          // timed out, possibly no internet connection
        } else {
          $scope.errors.update_comments = true;
        }
        console.dir(data);
        console.log('STATUS', status);
        console.log('HEADERS');
        console.dir(headers);
        console.log('CONFIG');
        console.dir(config);
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
            }
            if (!_bugs_left) {
              // count how many bugs we have comments for
              countBugsWithComments();
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
    console.log('Hmm... what to download?', _downloaded_comments);

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
    console.dir(bug);
    localForage.setItem('selected_bug', bug.id);
    fetchAndUpdateComments(bug);
    //console.dir(bug);
    $scope.bug = bug;
  };

  $scope.isSelectedBug = function(bug) {
    return bug.id == $scope.bug.id;
  };

  $scope.avatarURL = function(email, size) {
    size = size || 64;
    var secure = document.location.protocol === 'https:';
    if (email === 'mozilla+bugcloser@davedash.com') {
      return 'static/images/bugzilla-icon.png';
    }
    return get_gravatar(email, size, secure);
    return 'static/images/avatar.png';
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
  function isAllDigits(x) {
    return !x.match(/[^\d]/);
  }
  $scope.cleanLocalStorage = function(callback) {
    localForage.getItem('bugs', function(bug_ids) {
      //if (!bug_ids.length) return;
      localForage.length(function(L) {
        //console.log('L', L);
        for (var i=0; i < L; i++) {
          //console.log(i);
          localForage.key(i, function(K) {
            var k = '' + K;
            if (isAllDigits(k)) {
              if (!_.contains(bug_ids, K)) {
                //console.log('Removing', K);
                localForage.removeItem(K);
              }
            }
            if ((i + 1) === L && callback) {
              callback();
            }
          });
        }
      });
    });
  };

  $scope.makeBugzillaLink = function(id, comment_index) {
    return 'https://bugzilla.mozilla.org/show_bug.cgi?id=' + id;
  };

  $scope.hasAdditionalComments = function(bug) {
    return bug.comments != null && bug.comments.length > 1;
  };

  $scope.countAdditionalComments = function(bug) {
    return bug.comments.length - 1;
  };

  $scope.showFileSize = function(bytes) {
    return filesize(bytes);
  };

  $scope.refreshBugs = function() {
    console.log('Start refreshing bugs');
    $scope.products_changed = false;
    startLoading('Refreshing bug list');
    fetchAndUpdateBugs(function() {
      console.log('In fetchAndUpdateBugs callback');
      stopLoading();
      precalculateProductCounts();
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
        _.each(data.bugs, function(bug) {
          var combo = bug.product + ' :: ' + bug.component;
          if (!_.contains($scope.products, combo)) {
            $scope.products.push(combo);
          }
        });
        if (callback) callback();
      }).error(function(data, status, headers, config) {
        console.warn('Failure');
        console.dir(data);
        $scope.errors.finding_products = true;
        if (callback) callback();
      });
  }

  $scope.removeProduct = function(combo) {
    $scope.products = _.filter($scope.products, function(p) {
      return p !== combo;
    });
    localForage.setItem('products', $scope.products);
    $scope.products_changed = true;
    startLoading("Cleaning up local storage");
    $scope.cleanLocalStorage(function() {
      stopLoading();
    });
  };

  $scope.searchProductsByEmail = function() {
    if (this.email && this.email.trim()) {
      console.log('Search by', this.email);
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
    console.log('ADD', this.product_choice);
    $scope.products.push(this.product_choice);
    localForage.setItem('products', $scope.products);
    $scope.products_changed = true;
  };

  var _downloading_configuration = false;  // used to prevent onFocus on fire repeatedly
  $scope.product_choices = ['Be patient. It takes a while to download all options.'];
  $scope.product_choice = null;

  // this is always called in an aync process
  function _downloadConfiguration() {
    startLoading('Downloading all possible Products & Components');
    fetchConfiguration()
      .success(function(data) {
        stopLoading();
        $scope.product_choices = [];
        var all = [];
        for (var product_name in data.product) {
          all.push(product_name);
          for (var component_name in data.product[product_name].component) {
            all.push(product_name + ' :: ' + component_name);
          }
        }
        all.sort();
        localForage.setItem('all_product_choices', all, function() {
          var one_day = new Date().getTime() + 60 * 60 * 24 * 1000;
          localForage.setItem('all_product_choices_expires', one_day);
        });
        //console.dir(all);
        $scope.product_choices = all;
      }).error(function() {
        console.warn('Unable to download configuration');
      });
  }

  $scope.startSelectProducts = function() {
    if (_downloading_configuration) return;
    _downloading_configuration = true;
    localForage.getItem('all_product_choices', function(all_product_choices) {
      console.log('all_product_choices'); console.dir(all_product_choices);
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
      //console.log('Counting by product', product_combo);
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
    console.log('total_comments', total_comments);
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

  $scope.clearSearch = function() {
    $scope.search_q = '';
    $scope.in_search = false;
  };
  $scope.getAuthCookie = function() {
    console.log(this.email, this.password);
    var params = {
       Bugzilla_login: this.email,
       Bugzilla_password: this.password,
       Bugzilla_remember: 'on',
       GoAheadAndLogIn: 'Log in'
    }
    $http.post(BUGZILLA_LOGIN_URL, params)
      .success(function(data, status, headers, config) {
        console.log(data);
        console.log(status);
        console.log(headers()['Set-Cookie']);
        console.dir(config);
      }).error(function(data, status, headers, config) {
        console.warn('Failure');
        console.dir(data);
        console.log(status);
      });

  };

  $scope.isAssignedTo = function(bug) {
    return bug.assigned_to && bug.assigned_to != 'nobody@mozilla.org';
  };

}
