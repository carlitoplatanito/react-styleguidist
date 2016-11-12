'use strict';

/* eslint-disable no-console */

const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const merge = require('webpack-merge');
const prettyjson = require('prettyjson');
const semverUtils = require('semver-utils');
const isFunction = require('lodash/isFunction');
const omit = require('lodash/omit');

const webpackVersion = semverUtils.parseRange(require('webpack/package.json').version)[0].major;
const isWebpack2 = webpackVersion === '2';

const nodeModulesDir = path.resolve(__dirname, '../node_modules');
const sourceDir = path.resolve(__dirname, '../src');
const codeMirrorPath = getPackagePath('codemirror');

// These modules are used by Remark and they need json-loader
const jsonModules = [
	'remark-parse',
	'character-entities-html4',
	'character-reference-invalid',
	'character-entities-legacy',
	'character-entities',
	'hast-util-sanitize',
];

/**
 * Return npm package path.
 * In npm2 works only with packages required directly by this package.
 *
 * @param {string} packageName Package name.
 * @return {string}
 */
function getPackagePath(packageName) {
	// We resolve package.json because otherwise path.resolve returns main module path
	return path.dirname(require.resolve(packageName + '/package.json'));
}

/**
 * Return true if given regexp matches files of given type.
 *
 * @param {RegExp} matcher
 * @param {string} extension
 * @return {boolean}
 */
function matchesFileType(matcher, extension) {
	return matcher.test('test.' + extension);
}

/**
 * Check if Webpack loaders in user’s config will not interfere with our own loaders: they must have "include"
 * or "exclude" option.
 *
 * @param {object} webpackConfig
 */
function validateWebpackConfig(webpackConfig) {
	webpackConfig.module.loaders.forEach(loader => {
		if (
			!loader.include && !loader.exclude &&
			(matchesFileType(loader.test, 'js') || matchesFileType(loader.test, 'css'))
		) {
			throw Error(
				'Either "include" or "exclude" option is required for ' + loader.test + ' Webpack loader.\n' +
				'Otherwise your loader might interfere with loaders used by Styleguidist and cause obscure issues.'
			);
		}
	});
}

module.exports = function(config, env) {
	process.env.NODE_ENV = process.env.BABEL_ENV = env;

	const isProd = env === 'production';

	let webpackConfig = {
		entry: [],
		output: {
			path: config.styleguideDir,
			filename: 'build/bundle.js',
			chunkFilename: 'build/[name].js',
		},
		resolve: {
			alias: {
				codemirror: codeMirrorPath,
				'rsg-codemirror-theme.css': path.join(codeMirrorPath, `theme/${config.highlightTheme}.css`),
			},
		},
		resolveLoader: {
			moduleExtensions: ['-loader', '.loader'],
		},
		plugins: [
			new HtmlWebpackPlugin({
				title: config.title,
				template: config.template,
				inject: true,
			}),
			new webpack.DefinePlugin({
				'process.env': {
					NODE_ENV: JSON.stringify(env),
				},
			}),
		],
		module: {
			loaders: [
				{
					test: /\.js$/,
					include: sourceDir,
					loader: 'babel',
					query: {
						babelrc: false,
						presets: ['es2015', 'react', 'stage-0'],
					},
				},
				{
					test: new RegExp(`node_modules[/\\\\](${jsonModules.join('|')})[/\\\\].*\\.json$`),
					include: /node_modules/,
					loader: 'json',
				},
				{
					test: /\.css$/,
					include: [
						codeMirrorPath,
						getPackagePath('highlight.js'),
					],
					loader: 'style!css',
				},
			],
		},
	};

	const loaderModulesDirectories = [
		path.resolve(__dirname, '../loaders'),
		nodeModulesDir,
		'node_modules',
	];

	if (isWebpack2) {
		webpackConfig = merge(webpackConfig, {
			resolve: {
				extensions: ['.js', '.jsx', '.json'],
				modules: [
					sourceDir,
					nodeModulesDir,
					'node_modules',
				],
			},
			resolveLoader: {
				modules: loaderModulesDirectories,
			},
			plugins: [
				new webpack.LoaderOptionsPlugin({
					minimize: isProd,
					debug: !isProd,
					options: {
						styleguidist: config,
					},
				}),
			],
		});
	}
	else {
		webpackConfig = merge(webpackConfig, {
			styleguidist: config,
			resolve: {
				extensions: ['.js', '.jsx', '.json', ''],
				root: sourceDir,
				moduleDirectories: [
					nodeModulesDir,
					'node_modules',
				],
			},
			resolveLoader: {
				modulesDirectories: loaderModulesDirectories,
			},
			debug: !isProd,
		});
	}

	if (isProd) {
		webpackConfig = merge(webpackConfig, {
			devtool: false,
			cache: false,
			plugins: [
				new webpack.optimize.OccurrenceOrderPlugin(),
				new webpack.optimize.DedupePlugin(),
				new webpack.optimize.UglifyJsPlugin({
					compress: {
						warnings: false,
					},
					output: {
						comments: false,
					},
					mangle: false,
				}),
			],
		});
	}
	else {
		webpackConfig = merge(webpackConfig, {
			entry: [
				'webpack-hot-middleware/client',
			],
			cache: true,
			devtool: 'eval',
			stats: {
				colors: true,
				reasons: true,
			},
			plugins: [
				new webpack.HotModuleReplacementPlugin(),
				new webpack.NoErrorsPlugin(),
			],
		});
	}

	if (config.webpackConfig) {
		const userConfig = isFunction(config.webpackConfig)
			? config.webpackConfig(env)
			: config.webpackConfig
		;
		const filteredUserConfig = omit(
			userConfig,
			['output', 'resolveLoader', 'styleguidist']
		);
		webpackConfig = merge(webpackConfig, filteredUserConfig);
	}

	// Add Styleguidist’s entry point after user’s entry points so things like polyfills would work
	webpackConfig.entry.push(path.resolve(sourceDir, 'index'));

	if (config.updateWebpackConfig) {
		webpackConfig = config.updateWebpackConfig(webpackConfig, env);
	}

	validateWebpackConfig(webpackConfig);

	if (config.verbose) {
		console.log();
		console.log('Using Webpack config:');
		console.log(prettyjson.render(webpackConfig));
		console.log();
	}

	return webpackConfig;
};
