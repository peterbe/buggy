#!/usr/bin/env python

import codecs
import datetime
import hashlib
import os
import re
import shutil

import cssmin
import jsmin


build_regex = re.compile(
    '(<\!--\s*build:(\w+)\s+([\w\$\-\./]+)\s*-->(.*?)<\!--\s*endbuild\s-->)',
    re.MULTILINE | re.DOTALL
)
src_regex = re.compile('src=["\']([^"\']+)["\']')
href_regex = re.compile('href=["\']([^"\']+)["\']')


def _find_html_pages(source):
    paths = []
    for each in os.listdir(source):
        path = os.path.join(source, each)
        if os.path.isdir(path):
            paths.extend(_find_html_pages(path))
        elif os.path.isfile(path) and path.endswith('.html'):
            paths.append(path)
    return paths


def read(path):
    with codecs.open(path, 'r', 'utf-8') as f:
        return f.read()


def write(path, content):
    mkdir(os.path.dirname(path))
    with codecs.open(path, 'w', 'utf-8') as f:
        f.write(content)


def mkdir(newdir):
    """works the way a good mkdir should :)
        - already exists, silently complete
        - regular file in the way, raise an exception
        - parent directory(ies) does not exist, make them as well
    """
    if os.path.isdir(newdir):
        return
    if os.path.isfile(newdir):
        raise OSError("a file with the same name as the desired "
                      "dir, '%s', already exists." % newdir)
    head, tail = os.path.split(newdir)
    if head and not os.path.isdir(head):
        mkdir(head)
    if tail:
        os.mkdir(newdir)


def already_minified(filename):
    for part in ('-min-', '-min.', '.min.', '.minified.', '.pack.', '-jsmin.'):
        if part in filename:
            return True
    return False


def hash_all_css_images(css_code, rel_dir, source_dir, dest_dir):
    def replacer(match):
        filename = match.groups()[0]
        if (filename.startswith('"') and filename.endswith('"')) or \
          (filename.startswith("'") and filename.endswith("'")):
            filename = filename[1:-1]
        if 'data:image' in filename or filename.startswith('http://'):
            return 'url("%s")' % filename
        if filename == '.':
            # this is a known IE hack in CSS
            return 'url(".")'
        # It's really quite common that the CSS file refers to the file
        # that doesn't exist because if you refer to an image in CSS for
        # a selector you never use you simply don't suffer.
        # That's why we say not to warn on nonexisting files
        new_filename = filename
        full_path = os.path.abspath(os.path.join(rel_dir, filename))

        if os.path.isfile(full_path):
            hash = hashlib.md5(open(full_path, 'rb').read()).hexdigest()[:10]
            a, b = os.path.splitext(filename)
            new_filename = '%s-%s%s' % (a, hash, b)
            new_filename = os.path.basename(new_filename)
            new_filepath = os.path.abspath(os.path.join(dest_dir, new_filename))
            mkdir(os.path.dirname(new_filepath))
            shutil.copyfile(full_path, new_filepath)

        return match.group().replace(filename, new_filename)
    _regex = re.compile('url\(([^\)]+)\)')
    css_code = _regex.sub(replacer, css_code)

    return css_code

class Page(object):

    def __init__(self, path, source_directory, output_directory,
                 compress_js=True, compress_css=True,
                 inline_js=False, inline_css=True):
        self.path = path
        self.source_directory = source_directory
        if not output_directory.endswith('/'):
            output_directory += '/'
        self.output_directory = output_directory
        self.compress_js = compress_js
        self.compress_css = compress_css
        self.inline_js = inline_js
        self.inline_css = inline_css
        self.processed_files = [path]

    def _parse_html(self):
        content = read(self.path)
        for whole, type_, destination_name, bulk in build_regex.findall(content):

            output_directory = self.output_directory
            output_directory = os.path.join(
                output_directory,
                os.path.dirname(destination_name)
            )

            combined = []
            template = None
            if type_ == 'js':
                for src in src_regex.findall(bulk):
                    path = os.path.join(self.source_directory, src)
                    this_content = read(path)
                    self.processed_files.append(path)
                    if not already_minified(os.path.basename(path)):
                        this_content = jsmin.jsmin(this_content)
                    combined.append('/* %s */' % src)
                    combined.append(this_content.strip())
                if self.inline_js:
                    template = '<script>%s</script>'
                else:
                    tag_template = '<script src="%s"></script>'
            elif type_ == 'css':
                for href in href_regex.findall(bulk):
                    path = os.path.join(self.source_directory, href)
                    this_content = read(path)
                    this_content = hash_all_css_images(
                        this_content,
                        os.path.dirname(path),
                        self.source_directory,
                        output_directory
                    )
                    self.processed_files.append(path)
                    if not already_minified(os.path.basename(path)):
                        this_content = cssmin.cssmin(this_content)
                    combined.append('/* %s */' % href)
                    combined.append(this_content.strip())
                if self.inline_css:
                    template = '<style>%s</style>'
                else:
                    tag_template = '<link rel="stylesheet" href="%s">'

            combined.append('')  # so it ends with a newline
            combined = '\n'.join(combined)
            if template:
                content = content.replace(
                    whole,
                    template % combined
                )
            else:
                if '$hash' in destination_name:
                    destination_name = destination_name.replace(
                        '$hash',
                        hashlib.md5(combined).hexdigest()[:7]
                    )
                if '$date' in destination_name:
                    destination_name = destination_name.replace(
                        '$date',
                        datetime.datetime.utcnow().strftime('%Y-%m-%d')
                    )

                destination_path = os.path.join(
                    self.output_directory,
                    destination_name
                )

                write(destination_path, combined)
                destination_path = destination_path.replace(self.output_directory, '')
                #destination_path = os.path.basename(destination_path)
                content = content.replace(
                    whole,
                    tag_template % destination_path
                )

        return content

    def parse(self):
        new_content = self._parse_html()
        out_path = self.path.replace(
            self.source_directory,
            self.output_directory
        )
        write(out_path, new_content)


def copy_files(source, dest, processed_files):
    for each in os.listdir(source):
        path = os.path.join(source, each)
        if os.path.isdir(path):
            copy_files(
                path,
                os.path.join(dest, each),
                processed_files
            )
        elif each.endswith('~'):
            pass
        elif path not in processed_files:
            mkdir(dest)
            shutil.copyfile(path, os.path.join(dest, each))

def run(
        source_directory='./client',
        output_directory='./dist',
        wipe_first=False,
        inline_js=False,
        inline_css=False
    ):

    if wipe_first:
        assert output_directory not in source_directory
        if os.path.isdir(output_directory):
            shutil.rmtree(output_directory)

    processed_files = []
    for html_file in _find_html_pages(source_directory):
        page = Page(
            html_file, source_directory, output_directory,
            inline_js=inline_js, inline_css=inline_css
        )
        page.parse()
        processed_files.extend(page.processed_files)

    copy_files(source_directory, output_directory, processed_files)

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument(
        '-s',
        '--source-directory',
        help='Where the raw stuff is',
        default='./client',
    )
    parser.add_argument(
        '-o',
        '--output-directory',
        help='Where the generated stuff goes',
        default='./dist',
    )
    parser.add_argument(
        '-w',
        '--wipe-first',
        help='Clear output directory first',
        default=False,
        dest='wipe_first',
        action='store_true'
    )
    parser.add_argument(
        '--inline-css',
        help='Make all CSS inline',
        default=False,
        dest='inline_css',
        action='store_true'
    )
    parser.add_argument(
        '--inline-js',
        help='Make all JS inline',
        default=False,
        dest='inline_js',
        action='store_true'
    )
    args = parser.parse_args()
    run(
        source_directory=args.source_directory,
        output_directory=args.output_directory,
        wipe_first=args.wipe_first,
        inline_js=args.inline_js,
        inline_css=args.inline_css,
    )
