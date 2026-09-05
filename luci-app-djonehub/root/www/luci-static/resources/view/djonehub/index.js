'use strict';
'require view';
'require form';
'require fs';
'require ui';
'require uci';
'require dom';
'require poll';

function parseJson(text) {
	try {
		return JSON.parse(text || '{}');
	} catch (e) {
		return { ok: false, message: text || e.message };
	}
}

function notifyResult(text) {
	var result = parseJson(text);
	if (result.ok === false)
		ui.addNotification(null, E('p', {}, result.message || _('操作失败')), 'danger');
	else
		ui.addNotification(null, E('p', {}, result.message || _('操作完成')), 'info');
}

function resultDetails(result) {
	if (!result || !result.output)
		return '';

	return E('details', { 'style': 'margin-top:1em;' }, [
		E('summary', {}, _('查看详细输出')),
		E('pre', {
			'style': [
				'white-space: pre-wrap',
				'max-height: 320px',
				'overflow: auto',
				'margin-top: .75em',
				'padding: 1em',
				'border: 1px solid var(--border-color-medium)',
				'border-radius: 6px',
				'background: var(--background-color-low)',
				'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
				'font-size: 12px'
			].join(';')
		}, result.output)
	]);
}

function runScript(path, args) {
	return fs.exec_direct(path, args || []).then(function(text) {
		notifyResult(text);
		window.setTimeout(function() { location.reload(); }, 800);
	}).catch(function(e) {
		ui.addNotification(null, E('p', {}, e.message || String(e)), 'danger');
	});
}

function saveApplyThen(map, fn) {
	return map.save()
		.then(function() { return ui.changes.apply(false); })
		.then(fn);
}

function progressbar(usedKb, totalKb, percent) {
	var used = (parseInt(usedKb) || 0) * 1024;
	var total = (parseInt(totalKb) || 0) * 1024;
	var pc = Math.max(0, Math.min(100, parseInt(percent) || 0));
	var text = total ? '%1024.2mB / %1024.2mB (%d%%)'.format(used, total, pc) : _('未知');

	return E('div', {
		'class': 'cbi-progressbar',
		'title': text
	}, E('div', { 'style': 'width:%.2f%%'.format(pc) }));
}

function memoryText(kb) {
	var value = parseInt(kb) || 0;

	return value ? '%1024.2mB RSS'.format(value * 1024) : _('未运行');
}

function cpuMemoryText(status) {
	var cpuX100 = parseInt(status.cpu_percent_x100);
	var memoryKb = parseInt(status.memory_used_kb) || 0;
	var cpu = isNaN(cpuX100) ? ((parseInt(status.cpu_percent) || 0) * 100) : cpuX100;

	return '%.2f%% / %s'.format(cpu / 100, memoryText(memoryKb));
}

function statusBadge(active) {
	return E('span', {
		'style': 'color:%s; font-weight:700;'.format(active ? '#37a24d' : '#d9534f')
	}, active ? _('运行中') : _('已停止'));
}

function releaseRepoSlug(repo) {
	return (repo || 'https://github.com/563617356/djonehub-release')
		.replace(/^https?:\/\/github\.com\//, '')
		.replace(/^git@github\.com:/, '')
		.replace(/\/$/, '')
		.replace(/\.git$/, '');
}

function releaseLink(repo, version) {
	if (!repo || !/^v[0-9]/.test(version || ''))
		return version;

	return E('a', {
		'href': 'https://github.com/%s/releases/tag/%s'.format(repo, version),
		'target': '_blank',
		'rel': 'noreferrer'
	}, version);
}

function pluginVersionLink(repo, version) {
	if (/^[0-9]/.test(version || ''))
		return releaseLink(repo, 'v' + version);

	return releaseLink(repo, version);
}

function coreArchLabel(arch) {
	return arch && arch != 'unknown' ? 'linux_%s'.format(arch) : _('未知');
}

function loadingText(text) {
	return E('em', { 'class': 'spinning' }, text || _('正在加载...'));
}

function formatBytes(bytes) {
	var value = parseInt(bytes) || 0;

	if (value >= 1024 * 1024)
		return '%1024.2mB'.format(value);

	return '%d KiB'.format(Math.max(0, Math.round(value / 1024)));
}

function formatSpeed(bytes) {
	var value = parseInt(bytes) || 0;

	if (value <= 0)
		return '0 KiB/s';

	if (value >= 1024 * 1024)
		return '%1024.2mB/s'.format(value);

	return '%d KiB/s'.format(Math.max(1, Math.round(value / 1024)));
}

function taskTitle(type) {
	switch (type) {
	case 'install_core':
		return _('安装/更新 DJOneHub 核心');
	case 'rollback_core':
		return _('回滚 DJOneHub 核心');
	case 'update_plugin':
		return _('更新 LuCI 插件');
	case 'convert_identity':
		return _('转换模块 USB 身份');
	case 'switch_usbnet':
		return _('切换模块 USB 网络模式');
	case 'probe_device':
		return _('探测设备');
	default:
		return _('更新任务');
	}
}

function taskProgressbar(status) {
	var percent = status.state == 'completed' ? 100 : Math.max(0, Math.min(100, parseInt(status.percent) || 0));

	return E('div', {
		'class': 'cbi-progressbar',
		'style': 'margin:.75em 0;',
		'title': '%d%%'.format(percent)
	}, E('div', { 'style': 'width:%.2f%%'.format(percent) }));
}

return view.extend({
	logRefreshTimer: null,
	currentLogs: '',
	statusNode: null,
	taskTimer: null,
	taskModalBody: null,
	activeTaskId: null,
	activeTaskType: null,
	taskCompletedHandled: false,
	corePane: null,
	devicePane: null,
	deviceProbeTimer: null,
	deviceProbeTaskId: null,

	handleSaveApply: function(ev, mode) {
		return this.super('handleSaveApply', [ ev, mode ]).then(function() {
			return fs.exec_direct('/usr/share/djonehub/apply_config.sh', []).then(notifyResult);
		});
	},

	load: function() {
		return Promise.all([
			uci.load('djonehub'),
			fs.exec_direct('/usr/share/djonehub/status.sh', []).catch(function() { return '{}'; }),
			fs.exec_direct('/usr/share/djonehub/logs.sh', [ '100' ]).catch(function() { return ''; })
		]);
	},

	startTask: function(type, args) {
		return fs.exec_direct('/usr/share/djonehub/task_start.sh', [ type ].concat(args || []))
			.then(function(text) {
				var result = parseJson(text);
				if (result.ok === false || !result.id) {
					ui.addNotification(null, E('p', {}, result.message || _('任务启动失败')), 'danger');
					return;
				}

				this.showTaskDialog(result.id, type);
			}.bind(this))
			.catch(function(e) {
				ui.addNotification(null, E('p', {}, e.message || String(e)), 'danger');
			});
	},

	restoreRunningTask: function() {
		return fs.exec_direct('/usr/share/djonehub/task_status.sh', [])
			.then(function(text) {
				var status = parseJson(text);
				if (status && status.type == 'probe_device')
					return;
				if (status && (status.state == 'running' || status.state == 'starting') && status.id)
					this.showTaskDialog(status.id, status.type, status);
			}.bind(this))
			.catch(function() {});
	},

	showTaskDialog: function(id, type, initialStatus) {
		this.activeTaskId = id;
		this.activeTaskType = type || (initialStatus && initialStatus.type) || 'task';
		this.taskCompletedHandled = false;
		this.taskModalBody = E('div', {});

		ui.showModal(taskTitle(this.activeTaskType), [ this.taskModalBody ]);
		if (initialStatus)
			this.updateTaskDialog(initialStatus);

		this.pollTaskStatus();
		if (this.taskTimer)
			window.clearInterval(this.taskTimer);
		this.taskTimer = window.setInterval(this.pollTaskStatus.bind(this), 1000);
	},

	pollTaskStatus: function() {
		if (!this.activeTaskId)
			return Promise.resolve();

		return fs.exec_direct('/usr/share/djonehub/task_status.sh', [ this.activeTaskId ])
			.then(function(text) {
				var status = parseJson(text);
				if (status.ok === false) {
					ui.addNotification(null, E('p', {}, status.message || _('任务状态读取失败')), 'danger');
					return;
				}

				this.updateTaskDialog(status);
				if (status.state == 'completed' || status.state == 'failed' || status.state == 'canceled')
					this.finishTaskPolling(status);
			}.bind(this))
			.catch(function(e) {
				this.updateTaskDialog({ state: 'failed', message: e.message || String(e), log: [] });
				this.finishTaskPolling({ state: 'failed' });
			}.bind(this));
	},

	cancelTask: function() {
		if (!this.activeTaskId)
			return Promise.resolve();

		return fs.exec_direct('/usr/share/djonehub/task_cancel.sh', [ this.activeTaskId ])
			.catch(function(e) {
				ui.addNotification(null, E('p', {}, e.message || String(e)), 'danger');
			});
	},

	finishTaskPolling: function(status) {
		if (this.taskTimer) {
			window.clearInterval(this.taskTimer);
			this.taskTimer = null;
		}

		if (this.taskCompletedHandled)
			return;

		this.taskCompletedHandled = true;
		if (status.state == 'completed') {
			if (status.type == 'update_plugin') {
				window.setTimeout(function() { location.reload(); }, 3000);
			} else {
				this.refreshAfterTask(status);
			}
		}
	},

	refreshAfterTask: function(status) {
		return this.refreshStatus().then(function(freshStatus) {
			if (this.corePane && (status.type == 'install_core' || status.type == 'rollback_core')) {
				this.corePane.removeAttribute('data-loaded');
				this.corePane.removeAttribute('data-loading');
				return this.loadCorePane(this.corePane, freshStatus || {}, true);
			}

			if (this.devicePane && (status.type == 'convert_identity' || status.type == 'switch_usbnet')) {
				this.devicePane.removeAttribute('data-loaded');
				this.devicePane.removeAttribute('data-loading');
				return this.loadDevicePane(this.devicePane);
			}
		}.bind(this));
	},

	updateTaskDialog: function(status) {
		if (!this.taskModalBody)
			return;

		var state = status.state || 'running';
		var message = status.message || _('正在执行任务');
		var terminal = state == 'completed' || state == 'failed' || state == 'canceled';
		var total = parseInt(status.total) || 0;
		var downloaded = parseInt(status.downloaded) || 0;
		var percent = state == 'completed' ? 100 : (parseInt(status.percent) || 0);
		var hasDownloadStats = total > 0 || downloaded > 0 || status.file;
		var stats = terminal && !hasDownloadStats ? '' : (total > 0
			? '%s / %s · %s · %d%%'.format(formatBytes(downloaded), formatBytes(total), formatSpeed(status.speed_bps), percent)
			: '%s · %s'.format(formatBytes(downloaded), formatSpeed(status.speed_bps)));
		var logLines = status.log || [];
		var success = state == 'completed';
		var pluginDone = success && status.type == 'update_plugin';

		dom.content(this.taskModalBody, E('div', { 'style': 'min-width:min(620px, 86vw);' }, [
			E('div', {
				'class': 'alert-message %s'.format(success ? 'success' : (state == 'failed' || state == 'canceled' ? 'warning' : 'info'))
			}, pluginDone ? _('LuCI 插件已更新，3 秒后刷新页面。') : message),
			taskProgressbar(status),
			E('div', { 'style': 'display:flex; gap:1em; flex-wrap:wrap; margin-bottom:1em;' }, [
				E('strong', {}, status.stage || state),
				E('span', {}, status.file || ''),
				E('span', {}, stats)
			]),
			E('pre', {
				'style': [
					'white-space: pre-wrap',
					'max-height: 240px',
					'overflow: auto',
					'margin: 0 0 1em 0',
					'padding: 1em',
					'border: 1px solid var(--border-color-medium)',
					'border-radius: 6px',
					'background: var(--background-color-low)',
					'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
					'font-size: 12px'
				].join(';')
			}, logLines.length ? logLines.join('\n') : _('暂无日志')),
			E('div', { 'class': 'right' }, [
				!terminal && status.cancellable ? E('button', {
					'class': 'btn cbi-button cbi-button-reset',
					'click': ui.createHandlerFn(this, this.cancelTask)
				}, _('取消下载')) : '',
				' ',
				pluginDone ? E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': function() { location.reload(); }
				}, _('立即刷新')) : E('button', {
					'class': 'btn cbi-button cbi-button-neutral',
					'click': ui.createHandlerFn(this, function() {
						ui.hideModal();
						if (terminal && success)
							return this.refreshAfterTask(status);
					})
				}, terminal ? _('完成') : _('关闭'))
			])
		]));
	},

	renderCoreSummary: function(status, releases, refreshHandler) {
		var current = status.core_installed ? (status.core_version || _('已安装，版本未知')) : _('未安装');
		var backup = status.backup_version || _('无');
		var canUpdate = status.core_installed && releases.latest && status.core_version && status.core_version != releases.latest;
		var isLatest = status.core_installed && releases.latest && status.core_version == releases.latest;
		var repo = releases.repo || '';
		var latest = releases.loading ? loadingText(_('正在加载...')) : releaseLink(repo, releases.latest || _('未知'));
		if (!releases.loading && releases.latest && (canUpdate || isLatest))
			latest = E('span', {}, [
				latest,
				' ',
				E('span', { 'style': 'color:%s;'.format(canUpdate ? '#d58512' : '#37a24d') }, canUpdate ? _('(可更新)') : _('(已是最新版本)'))
			]);
		var currentArch = status.core_installed ? coreArchLabel(status.core_arch || status.core_arch_effective) : _('未安装');
		var rows = [
			[ _('当前版本'), releaseLink(repo, current) ],
			[ _('当前架构'), currentArch ],
			[ _('最新版本'), latest ],
			[ _('可回滚版本'), releaseLink(repo, backup) ],
			[ _('Release 仓库'), repo ? E('a', { 'href': 'https://github.com/%s/releases'.format(repo), 'target': '_blank', 'rel': 'noreferrer' }, repo) : _('未知') ]
		];

		var table = E('table', { 'class': 'table' }, rows.map(function(row) {
			return E('tr', {}, [ E('td', {}, row[0]), E('td', {}, row[1]) ]);
		}));

		var notice = null;

		if (releases.ok === false)
			notice = E('div', { 'class': 'alert-message warning' }, releases.message || _('无法获取 Release 版本列表。'));

		var nodes = [
			E('div', { 'class': 'cbi-section' }, [
				E('div', {
					'style': 'display:flex; align-items:center; justify-content:space-between; gap:1em; flex-wrap:wrap;'
				}, [
					E('h3', { 'style': 'margin-bottom:.75em;' }, _('核心状态')),
					E('button', {
						'class': 'btn cbi-button cbi-button-reload',
						'click': refreshHandler
					}, _('检测更新'))
				]),
				table
			])
		];

		if (notice)
			nodes.unshift(notice);

		return E('div', {}, nodes);
	},

	renderCoreMap: function(status, releases, refreshHandler) {
		var m = new form.Map('djonehub');
		var s, o;

		s = m.section(form.NamedSection, 'main', 'djonehub', _('核心管理'));
		s.addremove = false;

		o = s.option(form.Value, 'release_repo', _('Release 仓库地址'));
		o.default = 'https://github.com/563617356/djonehub-release';
		o.validate = function(section_id, value) {
			return /^(https?:\/\/github\.com\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(value) || _('必须是 GitHub 仓库地址');
		};

		o = s.option(form.ListValue, 'core_arch', _('核心架构'));
		o.value('arm64', 'linux_arm64');
		o.value('amd64', 'linux_amd64');
		o.value('armv7', 'linux_armv7');
		o.default = status.core_arch_effective || 'arm64';
		o.cfgvalue = function(section_id) {
			var value = uci.get('djonehub', section_id, 'core_arch');
			return value || status.core_arch_effective || 'arm64';
		};

		o = s.option(form.ListValue, 'version', _('指定版本'));
		o.value('latest', releases.loading ? _('最新版本（正在加载...）') : (releases.latest ? _('最新版本') + ' (' + releases.latest + ')' : _('最新版本')));
		(releases.versions || []).forEach(function(version) {
			o.value(version, version);
		});
		o.default = 'latest';

		o = s.option(form.Button, '_install_core', _('安装/更新核心'));
		o.inputstyle = 'apply';
		o.onclick = ui.createHandlerFn(this, function() {
			return m.save().then(function() {
				var version = uci.get('djonehub', 'main', 'version') || 'latest';
				var repo = uci.get('djonehub', 'main', 'release_repo') || 'https://github.com/563617356/djonehub-release';
				var arch = uci.get('djonehub', 'main', 'core_arch') || '';
				return this.startTask('install_core', [ version, repo, arch ]);
			}.bind(this));
		});

		o = s.option(form.Button, '_rollback_core', status.backup_version ? _('回滚核心') + ' (' + status.backup_version + ')' : _('回滚核心'));
		o.inputstyle = 'reset';
		o.onclick = ui.createHandlerFn(this, function() {
			return this.startTask('rollback_core', []);
		});

		return m.render().then(function(mapEl) {
			return E('div', {}, [
				this.renderCoreSummary(status, releases, refreshHandler),
				mapEl
			]);
		}.bind(this));
	},

	loadCorePane: function(corePane, status, force) {
		if (!force && (corePane.getAttribute('data-loaded') === 'true' || corePane.getAttribute('data-loading') === 'true'))
			return;

		var refreshHandler = ui.createHandlerFn(this, function() {
			return this.loadCorePane(corePane, status, true);
		});
		var repo = releaseRepoSlug(uci.get('djonehub', 'main', 'release_repo'));

		corePane.setAttribute('data-loading', 'true');
		this.renderCoreMap(status, { loading: true, repo: repo, versions: [] }, refreshHandler).then(function(coreEl) {
			dom.content(corePane, coreEl);
		});

		return fs.exec_direct('/usr/share/djonehub/releases.sh', [ '5' ])
			.catch(function(e) {
				return JSON.stringify({ ok: false, repo: repo, message: e.message || String(e), latest: '', versions: [] });
			})
			.then(function(text) {
				var releases = parseJson(text);
				if (!releases.repo)
					releases.repo = repo;

				return this.renderCoreMap(status, releases, refreshHandler).then(function(coreEl) {
					corePane.setAttribute('data-loaded', 'true');
					corePane.removeAttribute('data-loading');
					dom.content(corePane, coreEl);
				});
			}.bind(this));
	},

	renderPluginSummary: function(plugin, refreshHandler) {
		var repo = plugin.repo || 'Demogorgon314/luci-app-djonehub';
		var current = plugin.current || _('未知');
		var latest = plugin.loading ? loadingText(_('正在加载...')) : pluginVersionLink(repo, plugin.latest || _('未知'));
		if (!plugin.loading && plugin.latest && plugin.ok !== false)
			latest = E('span', {}, [
				latest,
				' ',
				E('span', { 'style': 'color:%s;'.format(plugin.has_update ? '#d58512' : '#37a24d') }, plugin.has_update ? _('(可更新)') : _('(已是最新版本)'))
			]);
		var rows = [
			[ _('当前版本'), pluginVersionLink(repo, current) ],
			[ _('最新版本'), latest ],
			[ _('Release 仓库'), E('a', { 'href': 'https://github.com/%s/releases'.format(repo), 'target': '_blank', 'rel': 'noreferrer' }, repo) ]
		];

		var table = E('table', { 'class': 'table' }, rows.map(function(row) {
			return E('tr', {}, [ E('td', {}, row[0]), E('td', {}, row[1]) ]);
		}));

		var notice = null;
		if (plugin.loading)
			notice = null;
		else if (plugin.ok === false)
			notice = E('div', { 'class': 'alert-message warning' }, plugin.message || _('无法获取插件版本信息。'));

		var versions = (plugin.versions || []).map(function(version) {
			return E('li', {}, pluginVersionLink(repo, version));
		});

		var nodes = [
			E('div', { 'class': 'cbi-section' }, [
				E('div', {
					'style': 'display:flex; align-items:center; justify-content:space-between; gap:1em; flex-wrap:wrap;'
				}, [
					E('h3', { 'style': 'margin-bottom:.75em;' }, _('插件状态')),
					E('button', {
						'class': 'btn cbi-button cbi-button-reload',
						'click': refreshHandler
					}, _('检测更新'))
				]),
				table
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('插件更新')),
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'disabled': plugin.has_update ? null : true,
					'click': ui.createHandlerFn(this, function() {
						return this.startTask('update_plugin', []);
					})
				}, _('更新 LuCI 插件')),
				plugin.loading ? E('div', { 'style': 'margin-top:1em;' }, loadingText(_('正在加载最近版本...'))) : '',
				versions.length ? E('div', { 'style': 'margin-top:1em;' }, [
					E('strong', {}, _('最近版本')),
					E('ul', {}, versions)
				]) : ''
			])
		];

		if (notice)
			nodes.unshift(notice);

		return E('div', {}, nodes);
	},

	loadPluginPane: function(pluginPane, force) {
		if (!force && (pluginPane.getAttribute('data-loaded') === 'true' || pluginPane.getAttribute('data-loading') === 'true'))
			return;

		var refreshHandler = ui.createHandlerFn(this, function() {
			return this.loadPluginPane(pluginPane, true);
		});

		pluginPane.setAttribute('data-loading', 'true');
		dom.content(pluginPane, this.renderPluginSummary({
			loading: true,
			repo: 'Demogorgon314/luci-app-djonehub',
			current: _('未知'),
			versions: []
		}, refreshHandler));

		return fs.exec_direct('/usr/share/djonehub/plugin_status.sh', [ '5' ])
			.catch(function(e) {
				return JSON.stringify({ ok: false, repo: 'Demogorgon314/luci-app-djonehub', current: _('未知'), message: e.message || String(e), latest: '', has_update: false, versions: [] });
			})
			.then(function(text) {
				var plugin = parseJson(text);

				pluginPane.setAttribute('data-loaded', 'true');
				pluginPane.removeAttribute('data-loading');
				dom.content(pluginPane, this.renderPluginSummary(plugin, refreshHandler));
			}.bind(this));
	},

	renderDeviceProbeLoading: function(devicePane, started, status) {
		var elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
		var message = status && status.message ? status.message : _('正在探测设备...');
		var stage = status && status.stage ? status.stage : 'probe';

		dom.content(devicePane, E('div', { 'class': 'cbi-section' }, [
			loadingText(message),
			E('p', { 'style': 'margin-top:.75em; color:var(--text-color-medium);' },
				_('当前阶段：%s，已等待 %d 秒。设备重新枚举时可能需要更久。').format(stage, elapsed))
		]));
	},

	fetchDeviceProbeCache: function(devicePane, result) {
		return fs.exec_direct('/usr/share/djonehub/device_probe.sh', [ 'cache' ])
			.catch(function(e) {
				return JSON.stringify({ ok: false, message: e.message || String(e), ports: [] });
			})
			.then(function(text) {
				var data = parseJson(text);
				devicePane.setAttribute('data-loaded', 'true');
				devicePane.removeAttribute('data-loading');
				this.deviceProbeTaskId = null;
				dom.content(devicePane, this.renderDeviceTools(devicePane, data, result));
			}.bind(this));
	},

	finishDeviceProbeLoading: function() {
		if (this.deviceProbeTimer) {
			window.clearInterval(this.deviceProbeTimer);
			this.deviceProbeTimer = null;
		}
	},

	pollDeviceProbe: function(devicePane, id, started, result) {
		return fs.exec_direct('/usr/share/djonehub/task_status.sh', [ id ])
			.then(function(text) {
				var status = parseJson(text);
				var terminal = status.state == 'completed' || status.state == 'failed' || status.state == 'canceled';

				if (this.deviceProbeTaskId != id)
					return;

				if (status.type && status.type != 'probe_device') {
					this.finishDeviceProbeLoading();
					this.deviceProbeTaskId = null;
					devicePane.removeAttribute('data-loading');
					dom.content(devicePane, this.renderDeviceTools(devicePane, {
						ok: false,
						message: _('已有其它后台任务正在运行，请稍后再探测设备。'),
						ports: []
					}, result));
					return;
				}

				this.renderDeviceProbeLoading(devicePane, started, status);
				if (!terminal)
					return;

				this.finishDeviceProbeLoading();
				if (status.state == 'completed')
					return this.fetchDeviceProbeCache(devicePane, result);

				devicePane.removeAttribute('data-loading');
				dom.content(devicePane, this.renderDeviceTools(devicePane, {
					ok: false,
					message: status.message || _('设备探测失败。'),
					ports: []
				}, result));
			}.bind(this))
			.catch(function(e) {
				this.finishDeviceProbeLoading();
				this.deviceProbeTaskId = null;
				devicePane.removeAttribute('data-loading');
				dom.content(devicePane, this.renderDeviceTools(devicePane, {
					ok: false,
					message: e.message || String(e),
					ports: []
				}, result));
			}.bind(this));
	},

	loadDevicePane: function(devicePane, result) {
		var started = Date.now();

		this.finishDeviceProbeLoading();

		devicePane.setAttribute('data-loading', 'true');
		this.renderDeviceProbeLoading(devicePane, started);

		return fs.exec_direct('/usr/share/djonehub/task_start.sh', [ 'probe_device' ])
			.catch(function(e) {
				return JSON.stringify({ ok: false, message: e.message || String(e) });
			})
			.then(function(text) {
				var task = parseJson(text);

				if (task.ok === false || !task.id) {
					devicePane.removeAttribute('data-loading');
					dom.content(devicePane, this.renderDeviceTools(devicePane, {
						ok: false,
						message: task.message || _('设备探测启动失败。'),
						ports: []
					}, result));
					return;
				}

				this.deviceProbeTaskId = task.id;
				this.pollDeviceProbe(devicePane, task.id, started, result);
				this.deviceProbeTimer = window.setInterval(function() {
					this.pollDeviceProbe(devicePane, task.id, started, result);
				}.bind(this), 1000);
			}.bind(this));
	},

	runDeviceTool: function(devicePane, args, confirmText) {
		if (confirmText && !window.confirm(confirmText))
			return Promise.resolve();

		dom.content(devicePane, E('div', { 'class': 'cbi-section' }, loadingText(_('正在执行操作...'))));

		return fs.exec_direct('/usr/share/djonehub/device_tools.sh', args)
			.catch(function(e) {
				return JSON.stringify({ ok: false, message: e.message || String(e) });
			})
			.then(function(text) {
				var result = parseJson(text);
				ui.addNotification(null, E('p', {}, result.message || (result.ok === false ? _('操作失败') : _('操作完成'))), result.ok === false ? 'danger' : 'info');
				return this.loadDevicePane(devicePane, result);
			}.bind(this));
	},

	renderDependencyState: function(label, installed) {
		return E('span', {
			'style': 'color:%s; font-weight:700;'.format(installed ? '#37a24d' : '#d9534f')
		}, installed ? _('%s: 已安装').format(label) : _('%s: 未安装').format(label));
	},

	renderDeviceDependencies: function(devicePane, data) {
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('依赖状态')),
			E('div', { 'style': 'display:flex; gap:1em; flex-wrap:wrap; align-items:center;' }, [
				this.renderDependencyState('kmod-usb-serial', data.serial_driver_installed),
				this.renderDependencyState('kmod-usb-serial-option', data.option_driver_installed),
				this.renderDependencyState('socat', data.socat_installed),
				data.serial_driver_installed && data.option_driver_installed ? '' : E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, function() {
						return this.runDeviceTool(devicePane, [ 'install_serial_drivers' ], _('确认安装串口驱动吗？\n\n这会执行 opkg update && opkg install kmod-usb-serial kmod-usb-serial-option。\n内核模块包需要匹配当前固件内核版本。'));
					})
				}, _('安装串口驱动')),
				data.socat_installed ? '' : E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, function() {
						return this.runDeviceTool(devicePane, [ 'install_socat' ], _('确认安装 socat 吗？\n\n这会执行 opkg update && opkg install socat。\n安装包会占用路由器存储空间，需要可用网络。'));
					})
				}, _('安装 socat'))
			])
		]);
	},

	deviceIdentityLabel: function(port) {
		if (port.identity_label && port.identity_label != _('未知'))
			return port.identity_label;
		return port.usb_config || _('未知');
	},

	renderIdentityAction: function(devicePane, port) {
		if (port.status != 'ok')
			return '-';

		if (port.identity == 'dji')
			return E('button', {
				'class': 'btn cbi-button cbi-button-apply',
				'click': ui.createHandlerFn(this, function() {
					if (!window.confirm(_('确认要将 %s 转换为 Quectel EC25 身份吗？\n\n此操作会写入模块内部 USB 配置，并重启模块。执行前会停止 DJOneHub，完成后会重新启动 DJOneHub。').format(port.port)))
						return Promise.resolve();
					return this.startTask('convert_identity', [ port.port, 'ec25' ]);
				})
			}, _('改成 EC25'));

		if (port.identity == 'ec25')
			return E('button', {
				'class': 'btn cbi-button cbi-button-reset',
				'click': ui.createHandlerFn(this, function() {
					if (!window.confirm(_('确认要将 %s 恢复为 DJI 身份吗？\n\n此操作会写入模块内部 USB 配置，并重启模块。执行前会停止 DJOneHub，完成后会重新启动 DJOneHub。').format(port.port)))
						return Promise.resolve();
					return this.startTask('convert_identity', [ port.port, 'dji' ]);
				})
			}, _('恢复 DJI 身份'));

		return _('暂不支持');
	},

	renderUsbnetActions: function(devicePane, port) {
		var modes = port.usbnet_profile == 'dji' ? [
			[ 'dji', '0', _('DJI') ],
			[ 'dji_rndis', '1', 'RNDIS' ],
			[ 'dji_ecm', '2', 'ECM' ],
			[ 'dji_ncm', '3', 'NCM' ],
			[ 'dji_mbim', '4', 'MBIM' ]
		] : [
			[ 'qmi', '0', 'QMI' ],
			[ 'ecm', '1', 'ECM' ],
			[ 'mbim', '2', 'MBIM' ]
		];

		if (port.status != 'ok' || !port.can_config || port.usbnet == null || port.usbnet === '')
			return '-';

		return E('div', { 'style': 'display:flex; gap:.4em; flex-wrap:wrap;' }, modes.map(function(mode) {
			var selected = String(port.usbnet) == mode[1];

			return E('button', {
				'class': 'btn cbi-button %s'.format(selected ? 'cbi-button-neutral' : 'cbi-button-action'),
				'disabled': selected ? 'disabled' : null,
				'click': selected ? null : ui.createHandlerFn(this, function() {
					if (!window.confirm(_('确认要将 %s 的 USB 网络模式切换为 %s 吗？\n\n此操作会写入模块内部配置，并重启模块。执行前会停止 DJOneHub，完成后会重新启动 DJOneHub。').format(port.port, mode[2])))
						return Promise.resolve();
					return this.startTask('switch_usbnet', [ port.port, mode[0] ]);
				})
			}, mode[2]);
		}.bind(this)));
	},

	renderInfoGrid: function(rows) {
		var children = [];

		rows.forEach(function(row) {
			children.push(E('div', { 'style': 'font-weight:700;' }, row[0]));
			children.push(E('div', { 'style': 'word-break:break-word;' }, row[1] || '-'));
		});

		return E('div', {
			'style': 'display:grid; grid-template-columns:minmax(8em, 14em) minmax(0, 1fr); gap:.45em 1em; align-items:start;'
		}, children);
	},

	renderPortCard: function(devicePane, port) {
		var summary = port.summary || {};
		var details = port.details || [];
		var statusColor = port.status == 'ok' ? '#37a24d' : '#d9534f';
		var title = port.port || '-';
		var usbLabel = port.usb_vidpid ? '%s · %s'.format(port.usb_vidpid, port.usb_identity_label || _('未知')) : _('未读取到 USB VID/PID');
		var children = [
			E('div', { 'style': 'display:flex; justify-content:space-between; gap:1em; flex-wrap:wrap; align-items:flex-start;' }, [
				E('div', {}, [
					E('h4', { 'style': 'margin:0 0 .35em 0;' }, title),
					E('div', { 'style': 'color:var(--text-color-medium);' }, usbLabel)
				]),
				E('div', { 'style': 'font-weight:700; color:%s;'.format(statusColor) }, port.status == 'ok' ? _('AT 可用') : _('无响应'))
			])
		];

		if (port.identity_mismatch)
			children.push(E('div', { 'class': 'alert-message warning', 'style': 'margin-top:.75em;' }, _('sysfs VID/PID 与 AT 内部 USB 配置不一致，请确认模块重启完成后再执行危险操作。')));

		children.push(
			this.renderInfoGrid([
				[ _('端口角色'), port.primary_at ? _('主 AT 口') : (port.status == 'ok' ? _('附属 AT 口') : _('非 AT 口') ) ],
				[ _('AT 身份'), port.identity_label || _('未知') ],
				[ _('模块'), port.module || summary.model || '-' ],
				[ _('固件'), summary.firmware || '-' ],
				[ _('SIM'), summary.sim || '-' ],
				[ _('信号'), summary.signal || '-' ],
				[ _('运营商'), summary.operator || '-' ],
				[ _('当前网络'), summary.network || '-' ],
				[ _('USB 网络模式'), port.usbnet_label || _('未知') ],
				[ _('USB 身份转换'), this.renderIdentityAction(devicePane, port) ],
				[ _('USB 网络模式切换'), this.renderUsbnetActions(devicePane, port) ]
			])
		);

		children.push(
			E('details', { 'style': 'margin-top:1em;' }, [
				E('summary', {}, _('详细信息')),
				this.renderInfoGrid(details.map(function(item) {
					return [ item.label, item.value || '-' ];
				})),
				E('details', { 'style': 'margin-top:.75em;' }, [
					E('summary', {}, _('完整 AT 输出')),
					E('pre', {
						'style': [
							'white-space: pre-wrap',
							'max-height: 320px',
							'overflow: auto',
							'margin-top: .75em',
							'padding: 1em',
							'border: 1px solid var(--border-color-medium)',
							'border-radius: 6px',
							'background: var(--background-color-low)',
							'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
							'font-size: 12px'
						].join(';')
					}, port.output || '-')
				])
			])
		);

		return E('div', {
			'class': 'cbi-section',
			'style': 'border:1px solid var(--border-color-medium); border-radius:6px; padding:1em; margin-bottom:1em;'
		}, children);
	},

	renderPortRole: function(port) {
		if (port.primary_at)
			return _('主 AT 口');
		if (port.status == 'ok')
			return _('附属 AT 口');
		return _('非 AT 口');
	},

	renderPortDetailsTable: function(ports) {
		return E('details', { 'style': 'margin-top:1em;' }, [
			E('summary', {}, _('USB 接口详情')),
			E('table', { 'class': 'table', 'style': 'margin-top:.75em;' }, [
				E('tr', {}, [
					E('th', {}, _('接口')),
					E('th', {}, _('串口')),
					E('th', {}, _('角色')),
					E('th', {}, _('状态')),
					E('th', {}, _('USB 身份')),
					E('th', {}, _('AT 身份'))
				])
			].concat(ports.map(function(port) {
				return E('tr', {}, [
					E('td', {}, port.usb_interface || '-'),
					E('td', {}, port.port || '-'),
					E('td', {}, this.renderPortRole(port)),
					E('td', {}, port.status == 'ok' ? _('AT 可用') : _('未探测')),
					E('td', {}, port.usb_identity_label || port.usb_vidpid || '-'),
					E('td', {}, port.identity_label || '-')
				]);
			}.bind(this))))
		]);
	},

	renderProbeCards: function(devicePane, data) {
		var ports = data.ports || [];
		var primaryPorts = ports.filter(function(port) { return port.primary_at; });
		var identifiedPorts = ports.filter(function(port) { return port.status == 'ok' && port.identity && port.identity != 'unknown'; });
		var visiblePorts = primaryPorts.length ? primaryPorts : identifiedPorts;
		var hasHiddenPorts = ports.length > visiblePorts.length;

		if (!ports.length)
			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('串口探测')),
				E('div', { 'class': 'alert-message warning' }, _('未发现 /dev/ttyUSB* 串口。请确认模块已接入，且串口驱动已安装。'))
			]);

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('串口探测')),
			E('p', {}, _('默认只显示身份明确的主 AT 口；其它接口折叠在 USB 接口详情中。')),
			visiblePorts.length ? E('div', {}, visiblePorts.map(function(port) {
				return this.renderPortCard(devicePane, port);
			}.bind(this))) : E('div', { 'class': 'alert-message warning' }, _('未找到身份明确的可操作 AT 口，请展开 USB 接口详情查看原始探测结果。')),
			hasHiddenPorts ? this.renderPortDetailsTable(ports) : ''
		]);
	},

	renderDeviceTools: function(devicePane, data, result) {
		var nodes = [
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'style': 'display:flex; align-items:center; justify-content:space-between; gap:1em; flex-wrap:wrap;' }, [
					E('h3', { 'style': 'margin-bottom:.75em;' }, _('设备工具')),
					E('button', {
						'class': 'btn cbi-button cbi-button-reload',
						'click': ui.createHandlerFn(this, function() {
							return this.loadDevicePane(devicePane);
						})
					}, _('刷新探测'))
				]),
				E('p', {}, _('专用于大疆 4G 模块与 Quectel EC25 USB 身份转换。转换会写入模块内部配置并重启模块。'))
			])
		];

		if (result)
			nodes.push(E('div', { 'class': 'alert-message %s'.format(result.ok === false ? 'danger' : 'success') }, [
				E('p', {}, result.message || (result.ok === false ? _('操作失败') : _('操作完成'))),
				resultDetails(result)
			]));

		if (data.ok === false)
			nodes.push(E('div', { 'class': 'alert-message danger' }, data.message || _('设备探测失败。')));

		nodes.push(this.renderDeviceDependencies(devicePane, data));

		if (!data.socat_installed && !(data.stty_available && data.timeout_available))
			nodes.push(E('div', { 'class': 'alert-message warning' }, _('当前系统缺少可用的串口读取工具。请安装 socat 后重试。')));

		nodes.push(E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('危险操作说明')),
			E('p', {}, _('USB 身份转换和 USB 网络模式切换会写入模块内部配置并重启模块。操作前会停止 DJOneHub，完成后会自动启动。'))
		]));

		nodes.push(this.renderProbeCards(devicePane, data));
		return E('div', {}, nodes);
	},

	renderConfigMap: function() {
		var m = new form.Map('djonehub');
		var s, o;

		s = m.section(form.NamedSection, 'main', 'djonehub', _('基础配置'));
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('启用服务'));
		o.default = '0';

		o = s.option(form.Value, 'host', _('监听地址'));
		o.default = '0.0.0.0';

		o = s.option(form.Value, 'port', _('监听端口'));
		o.default = '7575';
		o.datatype = 'port';

	o = s.option(form.Value, 'token', _('访问令牌 (API Token)'));
	o.password = true;
	o.rmempty = false;
	o.description = _('核心服务以此令牌进行 Bearer 鉴权。未设置时服务将拒绝启动。请使用强随机字符串，不要留空。');

		o = s.option(form.ListValue, 'log_level', _('日志级别'));
		o.value('debug', 'debug');
		o.value('info', 'info');
		o.value('warn', 'warn');
		o.value('error', 'error');
		o.default = 'info';

		o = s.option(form.Value, 'data_path', _('数据目录'));
		o.default = '/etc/djonehub/data';
		o.validate = function(section_id, value) {
			return /^\/.+/.test(value) || _('必须是绝对路径');
		};

		o = s.option(form.Button, '_apply_config', _('保存并应用'));
		o.inputstyle = 'apply';
		o.onclick = ui.createHandlerFn(this, function() {
			return saveApplyThen(m, function() {
				return runScript('/usr/share/djonehub/apply_config.sh', []);
			});
		});

		return m.render();
	},

	renderStatus: function(status) {
		var webUrl = 'http://%s:%s'.format(window.location.hostname, status.port || '7575');
		var listenAddress = '%s:%s'.format(status.host || '0.0.0.0', status.port || '7575');
		var releaseRepo = releaseRepoSlug(uci.get('djonehub', 'main', 'release_repo'));
		var coreVersion = status.core_installed ? (status.core_version || _('已安装')) : _('未安装');
		var rows = [
			[ _('服务状态'), statusBadge(status.running) ],
			[ _('开机启用'), status.enabled ? _('已启用') : _('未启用') ],
			[ _('核心状态'), status.core_installed ? releaseLink(releaseRepo, coreVersion) : coreVersion ],
			[ _('监听地址'), status.running ? E('a', { 'href': webUrl, 'target': '_blank' }, listenAddress) : listenAddress ],
			[ _('端口状态'), status.port_status || _('未知') ],
			[ _('CPU / 内存占用'), status.running ? cpuMemoryText(status) : _('未运行') ],
			[ _('根分区空间'), progressbar(status.root_used_kb, status.root_total_kb, status.root_percent) ],
			[ _('数据目录空间'), progressbar(status.data_used_kb, status.data_total_kb, status.data_percent) ]
		];

		var table = E('table', { 'class': 'table' }, rows.map(function(row) {
			return E('tr', {}, [ E('td', {}, row[0]), E('td', {}, row[1]) ]);
		}));

		var warnings = [];
		if (status.default_token)
			warnings.push(E('div', { 'class': 'alert-message warning' }, _('尚未配置访问令牌 (token)，DJOneHub 核心将拒绝启动。请在“基础配置”中设置强随机令牌。')));
		if (!status.core_installed)
			warnings.push(E('div', { 'class': 'alert-message warning' }, _('DJOneHub 核心尚未安装。')));

		return E('div', { 'class': 'cbi-section' }, [
			E('div', {
				'style': 'display:flex; align-items:center; justify-content:space-between; gap:1em; flex-wrap:wrap;'
			}, [
				E('h3', { 'style': 'margin-bottom:.75em;' }, _('运行状态')),
				status.running ? E('a', { 'class': 'btn cbi-button cbi-button-action', 'target': '_blank', 'href': webUrl }, _('打开 DJOneHub Web UI')) : ''
			]),
			table
		].concat(warnings));
	},

	updateStatusNode: function(status) {
		if (!this.statusNode)
			return;

		dom.content(this.statusNode, this.renderStatus(status));
	},

	refreshStatus: function() {
		return fs.exec_direct('/usr/share/djonehub/status.sh', [])
			.catch(function() { return '{}'; })
			.then(function(text) {
				var status = parseJson(text);
				this.updateStatusNode(status);
				return status;
			}.bind(this));
	},

	renderServiceButtons: function() {
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('服务操作')),
			E('button', {
				'class': 'btn cbi-button cbi-button-apply',
				'click': ui.createHandlerFn(this, function() { return runScript('/usr/share/djonehub/service.sh', [ 'start' ]); })
			}, _('启用并启动')),
			' ',
			E('button', {
				'class': 'btn cbi-button cbi-button-reset',
				'click': ui.createHandlerFn(this, function() { return runScript('/usr/share/djonehub/service.sh', [ 'stop' ]); })
			}, _('停止并禁用')),
			' ',
			E('button', {
				'class': 'btn cbi-button cbi-button-reload',
				'click': ui.createHandlerFn(this, function() { return runScript('/usr/share/djonehub/service.sh', [ 'restart' ]); })
			}, _('重启'))
		]);
	},

	refreshLogs: function(logNode) {
		return fs.exec_direct('/usr/share/djonehub/logs.sh', [ '100' ])
			.catch(function() { return ''; })
			.then(function(logs) {
				this.currentLogs = logs || '';
				dom.content(logNode, this.currentLogs || _('暂无日志'));
			}.bind(this));
	},

	setLogAutoRefresh: function(enabled, logNode) {
		if (this.logRefreshTimer) {
			window.clearInterval(this.logRefreshTimer);
			this.logRefreshTimer = null;
		}

		if (enabled) {
			this.refreshLogs(logNode);
			this.logRefreshTimer = window.setInterval(function() {
				this.refreshLogs(logNode);
			}.bind(this), 5000);
		}
	},

	clearLogs: function(logNode) {
		return fs.exec_direct('/usr/share/djonehub/clear_logs.sh', [])
			.then(function(text) {
				notifyResult(text);
				return this.refreshLogs(logNode);
			}.bind(this))
			.catch(function(e) {
				ui.addNotification(null, E('p', {}, e.message || String(e)), 'danger');
			});
	},

	downloadLogs: function() {
		var blob = new Blob([ this.currentLogs || '' ], { type: 'text/plain;charset=utf-8' });
		var url = URL.createObjectURL(blob);
		var a = E('a', {
			'href': url,
			'download': 'djonehub-logs.txt'
		});

		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
	},

	renderLogs: function(logs) {
		this.currentLogs = logs || '';
		var logNode = E('pre', {
			'style': [
				'white-space: pre',
				'height: 460px',
				'overflow: auto',
				'margin: 0',
				'padding: 1em',
				'border: 1px solid var(--border-color-medium)',
				'border-radius: 6px',
				'background: var(--background-color-low)',
				'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
				'font-size: 12px',
				'line-height: 1.55'
			].join(';')
		}, this.currentLogs || _('暂无日志'));

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('运行日志')),
			E('div', {
				'style': [
					'display: flex',
					'align-items: center',
					'justify-content: space-between',
					'gap: 1em',
					'flex-wrap: wrap',
					'margin-bottom: 1em'
				].join(';')
			}, [
				E('label', {
					'style': 'display: inline-flex; align-items: center; gap: .5em; margin: 0;'
				}, [
					E('input', {
						'type': 'checkbox',
						'style': 'margin: 0;',
						'change': function(ev) {
							this.setLogAutoRefresh(ev.target.checked, logNode);
						}.bind(this)
					}),
					E('span', {}, _('自动刷新'))
				]),
				E('div', { 'style': 'display: flex; gap: .5em; flex-wrap: wrap;' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-reload',
						'click': ui.createHandlerFn(this, function() { return this.refreshLogs(logNode); })
					}, _('刷新')),
					E('button', {
						'class': 'btn cbi-button cbi-button-reset',
						'click': ui.createHandlerFn(this, function() { return this.clearLogs(logNode); })
					}, _('清理日志')),
					E('button', {
						'class': 'btn cbi-button cbi-button-action',
						'click': ui.createHandlerFn(this, function() { this.downloadLogs(); })
					}, _('下载日志'))
				])
			]),
			logNode
		]);
	},

	render: function(data) {
		var status = parseJson(data[1]);
		var logs = data[2] || '';

		return Promise.all([
			this.renderConfigMap()
		]).then(function(rendered) {
			this.statusNode = E('div', {}, this.renderStatus(status));
			poll.add(this.refreshStatus.bind(this), 5);

			var corePane = E('div', { 'data-tab': 'core', 'data-tab-title': _('核心管理') }, [
				E('div', { 'class': 'cbi-section' }, E('em', {}, _('点击核心管理后加载版本列表。')))
			]);
			this.corePane = corePane;

			corePane.addEventListener('cbi-tab-active', function() {
				this.loadCorePane(corePane, status);
			}.bind(this));

			var devicePane = E('div', { 'data-tab': 'device', 'data-tab-title': _('设备工具') }, [
				E('div', { 'class': 'cbi-section' }, E('em', {}, _('点击设备工具后探测串口设备。')))
			]);
			this.devicePane = devicePane;

			devicePane.addEventListener('cbi-tab-active', function() {
				if (devicePane.getAttribute('data-loaded') !== 'true' && devicePane.getAttribute('data-loading') !== 'true')
					this.loadDevicePane(devicePane);
			}.bind(this));

			var pluginPane = E('div', { 'data-tab': 'plugin', 'data-tab-title': _('插件管理') }, [
				E('div', { 'class': 'cbi-section' }, E('em', {}, _('点击插件管理后加载插件版本信息。')))
			]);

			pluginPane.addEventListener('cbi-tab-active', function() {
				this.loadPluginPane(pluginPane);
			}.bind(this));

			var panes = E('div', {}, [
				E('div', { 'data-tab': 'home', 'data-tab-title': _('首页') }, [
					this.statusNode,
					this.renderServiceButtons()
				]),
				corePane,
				devicePane,
				E('div', { 'data-tab': 'config', 'data-tab-title': _('基础配置') }, rendered[0]),
				E('div', { 'data-tab': 'logs', 'data-tab-title': _('日志') }, this.renderLogs(logs)),
				pluginPane
			]);
			var tabs = E('div', {}, panes);

			ui.tabs.initTabGroup(panes.childNodes);
			window.setTimeout(this.restoreRunningTask.bind(this), 0);

			return E('div', {}, [
				E('h2', {}, _('DJOneHub')),
				E('div', { 'class': 'cbi-map-descr' }, _('管理 DJOneHub 核心、服务和基础配置；支持短信、多卡、eSIM/eUICC、轻量代理与 Bot 远程控制。')),
				tabs
			]);
		}.bind(this));
	}
});
