/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ISCMService } from '../common/scm.js';
import { Event } from '../../../../base/common/event.js';

export class NullSCMService implements ISCMService {
	declare readonly _serviceBrand: undefined;

	onDidAddProvider = Event.None;
	onDidRemoveProvider = Event.None;
	providerIds = new Set<string>();
	providers = [];
	getRepository() { return undefined; }
	registerSCMProvider() { return { dispose: () => { } }; }
}

registerSingleton(ISCMService, NullSCMService, InstantiationType.Delayed);
