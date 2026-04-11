/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IRemoteExtensionsScannerService } from '../../../../platform/remote/common/remoteExtensionsScanner.js';
import { InstallExtensionSummary } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';

export class NullRemoteExtensionsScannerService implements IRemoteExtensionsScannerService {
	declare readonly _serviceBrand: undefined;

	whenExtensionsReady(): Promise<InstallExtensionSummary> {
		return Promise.resolve({ failed: [] });
	}

	scanExtensions(): Promise<IExtensionDescription[]> {
		return Promise.resolve([]);
	}
}

registerSingleton(IRemoteExtensionsScannerService, NullRemoteExtensionsScannerService, InstantiationType.Delayed);
