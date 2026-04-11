/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IExtensionService, IWillActivateEvent, IResponsiveStateChangeEvent, WillStopExtensionHostsEvent, ExtensionActivationReason, ExtensionHostKind, IExtensionPoint, ExtensionPointContribution, IExtensionsStatus } from '../common/extensions.js';
import { IExtensionDescription, ExtensionIdentifier, TargetPlatform } from '../../../../platform/extensions/common/extensions.js';
import { Event } from '../../../../base/common/event.js';
import { IBuiltinExtensionsScannerService, IExtension } from '../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ExtensionMessageCollector, ExtensionsRegistry, IExtensionPointUser } from '../common/extensionsRegistry.js';

/**
 * BuiltinExtensionService - Loads only builtin extensions (for themes, icons, etc.)
 * Does not start extension hosts or activate extensions.
 */
export class BuiltinExtensionService implements IExtensionService {
	declare readonly _serviceBrand: undefined;

	readonly onDidRegisterExtensions: Event<void> = Event.None;
	readonly onDidChangeExtensionsStatus = Event.None;
	readonly onDidChangeExtensions = Event.None;
	readonly onWillActivateByEvent: Event<IWillActivateEvent> = Event.None;
	readonly onDidChangeResponsiveChange: Event<IResponsiveStateChangeEvent> = Event.None;
	readonly onWillStop: Event<WillStopExtensionHostsEvent> = Event.None;

	private _extensions: IExtensionDescription[] = [];
	private _registerExtensionsPromise: Promise<void> | undefined;

	constructor(
		@IBuiltinExtensionsScannerService private readonly _builtinExtensionsScannerService: IBuiltinExtensionsScannerService,
		@ILogService private readonly _logService: ILogService,
	) {
		this._registerExtensionsPromise = this._registerExtensions();
	}

	get extensions(): readonly IExtensionDescription[] {
		return this._extensions;
	}

	async activateByEvent(_activationEvent: string): Promise<void> {
		// No-op: builtin extensions don't need activation
	}

	async activateById(extensionId: ExtensionIdentifier, _reason: ExtensionActivationReason): Promise<void> {
		// No-op: builtin extensions don't need activation
	}

	activationEventIsDone(_activationEvent: string): boolean {
		return true;
	}

	async whenInstalledExtensionsRegistered(): Promise<boolean> {
		await this._registerExtensionsPromise;
		return true;
	}

	async getExtension(extensionId: string): Promise<IExtensionDescription | undefined> {
		await this._registerExtensionsPromise;
		return this._extensions.find(ext => ExtensionIdentifier.equals(ext.identifier, extensionId));
	}

	async readExtensionPointContributions<T>(extPoint: IExtensionPoint<T>): Promise<ExtensionPointContribution<T>[]> {
		await this._registerExtensionsPromise;
		const contributions: ExtensionPointContribution<T>[] = [];
		for (const ext of this._extensions) {
			if (ext.contributes && ext.contributes[extPoint.name]) {
				contributions.push({
					description: ext,
					value: ext.contributes[extPoint.name],
					collector: new ExtensionMessageCollector(this._logService, ext, extPoint.name)
				});
			}
		}
		return contributions;
	}

	getExtensionsStatus(): { [id: string]: IExtensionsStatus } {
		return Object.create(null);
	}

	async getInspectPorts(_extensionHostKind: ExtensionHostKind, _tryEnableInspector: boolean): Promise<{ port: number; host: string }[]> {
		return [];
	}

	async stopExtensionHosts(): Promise<boolean> {
		return true;
	}

	async startExtensionHosts(): Promise<void> {
		// No-op
	}

	async setRemoteEnvironment(_env: { [key: string]: string | null }): Promise<void> {
		// No-op
	}

	canAddExtension(): boolean {
		return false;
	}

	canRemoveExtension(): boolean {
		return false;
	}

	private async _registerExtensions(): Promise<void> {
		try {
			const builtinExtensions = await this._builtinExtensionsScannerService.scanBuiltinExtensions();
			this._extensions = builtinExtensions.map((ext: IExtension) => ({
				...ext.manifest,
				identifier: new ExtensionIdentifier(ext.identifier.id),
				extensionLocation: ext.location,
				isUserBuiltin: true,
				isBuiltin: true,
				targetPlatform: TargetPlatform.WEB,
				isUnderDevelopment: false,
				preRelease: false,
			} as IExtensionDescription));

			// Process extension points - notify all registered extension points
			const extensionPoints = ExtensionsRegistry.getExtensionPoints();
			for (const extensionPoint of extensionPoints) {
				const users: IExtensionPointUser<any>[] = [];
				for (const desc of this._extensions) {
					if (desc.contributes && Object.prototype.hasOwnProperty.call(desc.contributes, extensionPoint.name)) {
						users.push({
							description: desc,
							value: desc.contributes[extensionPoint.name as keyof typeof desc.contributes],
							collector: new ExtensionMessageCollector(this._logService, desc, extensionPoint.name)
						});
					}
				}
				extensionPoint.acceptUsers(users);
			}

			this._logService.info(`[BuiltinExtensionService] Loaded ${this._extensions.length} builtin extensions`);
		} catch (error) {
			this._logService.error('[BuiltinExtensionService] Failed to load builtin extensions:', error);
		}
	}
}

registerSingleton(IExtensionService, BuiltinExtensionService, InstantiationType.Delayed);
