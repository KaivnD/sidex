/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IDebugService } from '../common/debug.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IConfig, IDebugSession, ILaunch, IDebugger, ICompound, IDebugConfigurationProvider, IDebugAdapterDescriptorFactory, IDebugAdapterTrackerFactory } from '../../../../platform/debug/common/debug.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import Severity from '../../../../base/common/severity.js';

export const IDebugEditorContribution = createDecorator<IDebugEditorContribution>('debugEditorContribution');

export interface IDebugEditorContribution extends IEditorContribution {
	onDebugStateUpdate(state: State): void;
}

export enum State {
	Inactive = 0,
	Initializing = 1,
	Stopped = 2,
	Running = 3
}

export class NullDebugService implements IDebugService {
	declare readonly _serviceBrand: undefined;

	onDidChangeState = Event.None;
	onDidNewSession = Event.None;
	onWillNewSession = Event.None;
	onDidEndSession = Event.None;

	get state(): State { return State.Inactive; }

	getModel() { return undefined as any; }
	getAdapterManager() { return undefined as any; }
	canSetBreakpointsIn() { return true; }
	addBreakpoints() { return Promise.resolve([]); }
	updateBreakpoints() { return Promise.resolve(); }
	enableOrDisableBreakpoints() { return Promise.resolve(); }
	setBreakpointsActivated() { return Promise.resolve(); }
	removeBreakpoints() { return Promise.resolve(); }
	addFunctionBreakpoint() { }
	moveWatchExpression() { }
	renameFunctionBreakpoint() { return Promise.resolve(); }
	renameWatchExpression() { return Promise.resolve(); }
	removeFunctionBreakpoints() { return Promise.resolve(); }
	replaceBreakpoints() { }
	setExceptionBreakpointState() { }
	setExceptionBreakpointCondition() { return Promise.resolve(); }
	sendExceptionBreakpoints() { return Promise.resolve(); }
	addWatchExpression() { return Promise.resolve(undefined); }
	removeWatchExpressions() { }
	startDebugging() { return Promise.resolve(false); }
	stopDebugging() { return Promise.resolve(); }
	restartSession() { return Promise.resolve(); }
	get onDidCustomEvent() { return Event.None; }
	customDebugRequest() { return Promise.resolve(); }
	getCompound() { return undefined; }
	getConfigurationManager() { return undefined as any; }
	getDebugToolbar() { return undefined as any; }
	getViewModel() { return undefined as any; }
	focusStackFrame() { }
	addFunctionBreakpointAsync() { return Promise.resolve(undefined); }
	sendAllBreakpoints() { return Promise.resolve(); }
	registerDebugConfigurationProvider() { return { dispose: () => { } }; }
	registerDebugAdapterDescriptorFactory() { return { dispose: () => { } }; }
	registerDebugAdapterTrackerFactory() { return { dispose: () => { } }; }
	getConfigurationNames() { return []; }
	getLaunches() { return []; }
	getSelectedLaunch() { return undefined as any; }
	setDebugSessionName() { }
	getEditorContributions() { return []; }
	getSession() { return undefined; }
	getSessions() { return []; }
	onDidFocusSession = Event.None;
	get stoppedDetails() { return undefined; }
	onDidFocusStackFrame = Event.None;
	onDidSelectExpression = Event.None;
	onDidEvaluateLazyExpression = Event.None;
	evaluateReplExpression() { }
	onDidChangeREPLElements = Event.None;
	logToREPL() { }
	appendToRepl() { }
	onDidEndAdapter = Event.None;
	removeReplExpressions() { }
	copyStackTrace() { return Promise.resolve(); }
	focusRepl() { }
	setWatchExpression() { return Promise.resolve(undefined); }
	clearWatchExpressionValues() { }
	get onWillStopSession() { return Event.None; }
	extensionsAvailablePromise() { return Promise.resolve(); }
	getExtensionHostDebugAdapter() { return Promise.resolve(undefined); }
	canToggleBreakpoints() { return true; }
	isMultiSessionView() { return false; }
	setStackFrameFocus() { }
	cancelTokens() { }
}

registerSingleton(IDebugService, NullDebugService, InstantiationType.Delayed);
