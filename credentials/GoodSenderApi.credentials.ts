import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class GoodSenderApi implements ICredentialType {
	name = 'goodSenderApi';

	displayName = 'GoodSender API';

	documentationUrl = 'https://goodsender.com/docs/api-reference/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Your GoodSender API key. Create one in the GoodSender dashboard. Sent as a Bearer token on every request.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.goodsender.com',
			description:
				'GoodSender API base URL. Leave as the default for production; override only for dev/staging (e.g. https://api.dev.goodsender.com).',
		},
	];

	// Injects "Authorization: Bearer <apiKey>" on every request.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// Validates the key against a cheap GET endpoint. Returns 401 on a bad key.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/domains',
			method: 'GET',
		},
	};
}
