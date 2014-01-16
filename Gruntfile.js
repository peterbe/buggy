module.exports = function(grunt) {

  var JS_FILE_PATH = 'client/static/js/';

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    concat: {
       options: {
          separator: ';',
       },
      dist: {
         src: ['client/static/js/*.js',
               //'client/static/js/md5.js',
               //'client/static/js/angularforage.js',
               //'client/static/js/utils.js',
               //'client/static/js/buggy.js',
               ],
          dest: 'dist/build-<%= grunt.template.today("yyyy-mm-dd") %>.js',
      },
    },
    uglify: {
       my_stuff: {
          options: {
             banner: '/*! <%= pkg.name %> <%= grunt.template.today("yyyy-mm-dd") %> */\n'
          },
          files: {
            'dist/build-<%= grunt.template.today("yyyy-mm-dd") %>.min.js':
              'client/static/js/*.js'
          }
       },
       vendor: {
          options: {
             banner: '/*! <%= pkg.name %> <%= grunt.template.today("yyyy-mm-dd") %> */\n',
             mangle: false,
             preserveComments: true
          },
          files: {
            'dist/vendor-<%= grunt.template.today("yyyy-mm-dd") %>.min.js':
              'client/static/js/vendor/*.js'
          }
       }
    },
    cssmin: {
      compress: {
        files: {
          'dist/all-<%= grunt.template.today("yyyy-mm-dd") %>.min.css':
            ['client/static/css/pure-min.css',
             'client/static/css/email.css',
             'client/static/css/extra.css']
        }
      }
    },
    jshint: {
      all: [
        'client/static/js/*.js',
        '!client/static/js/md5.js',
        // Ignore these, they are someone else's problem
        '!client/static/js/vendor/*.js',
      ],
//      options: {
//        jshintrc: '.jshintrc'
//      }
    }
  });

  grunt.loadNpmTasks('grunt-contrib-concat');
  grunt.loadNpmTasks('grunt-contrib-cssmin');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-uglify');
//  grunt.loadNpmTasks('grunt-contrib-nodeunit');
//  grunt.loadNpmTasks('grunt-contrib-requirejs');
//  grunt.loadNpmTasks('grunt-contrib-watch');
//  grunt.registerTask('build', ['cssmin', 'requirejs', 'concat']);
  grunt.registerTask('build', ['cssmin', 'uglify', 'concat']);
//  grunt.registerTask('default', ['jshint', 'build', 'nodeunit']);
  grunt.registerTask('default', ['jshint', 'build']);
//  grunt.registerTask('travis', ['jshint', 'nodeunit']);
};
