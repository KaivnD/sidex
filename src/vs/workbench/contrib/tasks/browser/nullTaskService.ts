/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ITaskService } from '../common/taskService.js';
import { Event } from '../../../../base/common/event.js';

export class NullTaskService implements ITaskService {
	declare readonly _serviceBrand: undefined;

	onDidStateChange = Event.None;
	onDidProcessTaskStateChange = Event.None;
	supportedExecutionEngines = [];
	getActiveTasks() { return Promise.resolve([]); }
	getBusyTasks() { return []; }
	getTaskSets() { return []; }
	taskSet() { return undefined; }
	getBeforeShutdown() { return Promise.resolve({ confirmed: true }); }
	canRunCommand() { return false; }
	getSystem() { return { tasks: [] }; }
	run() { return Promise.resolve(undefined); }
	inTerminal() { return Promise.resolve(undefined); }
	runTaskCommand() { }
	terminate() { return Promise.resolve({ success: true }); }
	terminateAll() { return Promise.resolve(); }
	restart() { return Promise.resolve(); }
	isActive() { return Promise.resolve(false); }
	getActive() { return Promise.resolve([]); }
	getRecentlyUsedTasks() { return Promise.resolve(new Map()); }
	createSorter() { return { sort: () => 0 }; }
	getTaskDescription() { return ''; }
	getWorkspaceTasks() { return Promise.resolve(new Map()); }
	getWorkspaceTask() { return Promise.resolve(undefined); }
	getTask() { return Promise.resolve(undefined); }
	isTaskConfigured() { return Promise.resolve(false); }
	setTaskEnabled() { return Promise.resolve(); }
	getTaskFolders() { return []; }
	needsFolderAttention() { return false; }
	isTaskProviderEnabled() { return true; }
	setTaskProviderEnabled() { }
	getTaskProviderEnabled() { return true; }
	getKeybinding() { return undefined; }
	getRunningTasks() { return []; }
	taskExecutions() { return []; }
	isTaskRunning() { return false; }
	isTaskExecuting() { return false; }
	getTaskExecution() { return undefined; }
	inBackground() { return Promise.resolve(false); }
	canCustomize() { return false; }
	customize() { return Promise.resolve(undefined); }
	openConfig() { return Promise.resolve(undefined); }
	reloadTasks() { return Promise.resolve(); }
	removeTasksList() { return Promise.resolve(); }
	clearTask() { }
	clearRecentTasksList() { }
	registerTaskProvider() { return { dispose: () => { } }; }
	registerTaskSystem() { }
}

registerSingleton(ITaskService, NullTaskService, InstantiationType.Delayed);
