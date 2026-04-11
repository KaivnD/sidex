/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { IShellLaunchConfig } from '../../../../platform/terminal/common/terminal.js';
import { IEmbedderTerminalOptions } from './embedderTerminalService.js';

export const IEmbedderTerminalService = createDecorator<IEmbedderTerminalService>('embedderTerminalService');

export interface IEmbedderTerminalService {
	readonly _serviceBrand: undefined;
	readonly onDidCreateTerminal: Event<IShellLaunchConfig>;
	createTerminal(options: IEmbedderTerminalOptions): void;
}

export class NullEmbedderTerminalService implements IEmbedderTerminalService {
	declare readonly _serviceBrand: undefined;
	onDidCreateTerminal = Event.None;
	createTerminal(_options: IEmbedderTerminalOptions): void {
		// No-op
	}
}

registerSingleton(IEmbedderTerminalService, NullEmbedderTerminalService, InstantiationType.Delayed);
