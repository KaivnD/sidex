/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ISpeechService, ISpeechProvider, ISpeechToTextSession, ITextToSpeechSession, KeywordRecognitionStatus } from '../common/speechService.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

export class NullSpeechService implements ISpeechService {
	declare readonly _serviceBrand: undefined;

	onDidChangeHasSpeechProvider = Event.None;
	hasSpeechProvider = false;

	onDidStartSpeechToTextSession = Event.None;
	onDidEndSpeechToTextSession = Event.None;
	hasActiveSpeechToTextSession = false;

	onDidStartTextToSpeechSession = Event.None;
	onDidEndTextToSpeechSession = Event.None;
	hasActiveTextToSpeechSession = false;

	onDidStartKeywordRecognition = Event.None;
	onDidEndKeywordRecognition = Event.None;
	hasActiveKeywordRecognition = false;

	registerSpeechProvider(): IDisposable {
		return { dispose: () => {} };
	}

	async createSpeechToTextSession(): Promise<ISpeechToTextSession> {
		return {
			onDidChange: Event.None
		};
	}

	async createTextToSpeechSession(): Promise<ITextToSpeechSession> {
		return {
			onDidChange: Event.None,
			synthesize: async () => {}
		};
	}

	async recognizeKeyword(): Promise<KeywordRecognitionStatus> {
		return KeywordRecognitionStatus.Canceled;
	}
}

registerSingleton(ISpeechService, NullSpeechService, InstantiationType.Delayed);
