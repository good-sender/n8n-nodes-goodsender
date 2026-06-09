import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

// --- helpers -------------------------------------------------------------

interface Address {
	email: string;
	name?: string;
}

function address(email: string, name?: string): Address {
	const trimmedName = (name ?? '').trim();
	return trimmedName ? { email, name: trimmedName } : { email };
}

/** Coerces any value to a string. The template API rejects non-string variables. */
function toStr(value: unknown): string {
	return value === undefined || value === null ? '' : String(value);
}

/** Turns a fixedCollection of {key,value} rows into a flat string map. */
function keyValueToObject(raw: IDataObject): IDataObject {
	const rows = (raw?.variable as IDataObject[] | undefined) ?? [];
	const out: IDataObject = {};
	for (const row of rows) {
		const key = (row.key as string | undefined)?.trim();
		if (key) out[key] = toStr(row.value);
	}
	return out;
}

/**
 * The variables each built-in template accepts, in display order. Drives both
 * the per-template input fields and the body assembled in buildTemplateBody.
 * Source: goodsender-web/templates/<id>/variables.json.
 */
const TEMPLATE_VARIABLES: Record<string, string[]> = {
	otp_code: ['app_name', 'otp_code', 'expiry_minutes', 'purpose', 'anti_phishing_notice'],
	mfa_enrollment: ['app_name', 'mfa_method', 'enrolled_at'],
	new_device_login: ['app_name', 'login_time', 'additional_info'],
	order_completed: ['app_name', 'order_id', 'order_total', 'completed_at'],
	order_receipt: [
		'app_name',
		'description',
		'receipt_number',
		'purchase_date',
		'payment_method',
		'total',
	],
	email_changed: ['app_name', 'new_email', 'changed_at', 'additional_info'],
	password_changed: ['app_name', 'changed_at', 'additional_info'],
};

// --- preSend body builders (assemble the exact JSON the API expects) -----

async function buildTemplateBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const choice = this.getNodeParameter('templateId') as string;
	const isCustom = choice === '__custom__';
	const templateId = isCustom ? (this.getNodeParameter('templateIdCustom') as string) : choice;

	let variables: IDataObject;
	if (isCustom) {
		variables = keyValueToObject(this.getNodeParameter('customVariables', {}) as IDataObject);
	} else {
		// Read each named field for the selected template; coerce to string, omit blanks.
		variables = {};
		for (const key of TEMPLATE_VARIABLES[choice] ?? []) {
			const value = toStr(this.getNodeParameter(key, ''));
			if (value !== '') variables[key] = value;
		}
	}

	const template: IDataObject = { template_id: templateId };
	if (Object.keys(variables).length > 0) template.variables = variables;

	requestOptions.body = {
		from: address(
			this.getNodeParameter('fromEmail') as string,
			this.getNodeParameter('fromName', '') as string,
		),
		to: address(
			this.getNodeParameter('toEmail') as string,
			this.getNodeParameter('toName', '') as string,
		),
		subject: this.getNodeParameter('subject') as string,
		template,
	};
	return requestOptions;
}

async function buildCustomBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const contentType = this.getNodeParameter('contentType') as string;
	const content = this.getNodeParameter('content') as string;
	const contentKey =
		contentType === 'html'
			? 'html_content'
			: contentType === 'text'
				? 'text_content'
				: 'markdown_content';

	const email: IDataObject = {
		from: address(
			this.getNodeParameter('fromEmail') as string,
			this.getNodeParameter('fromName', '') as string,
		),
		to: [
			address(
				this.getNodeParameter('toEmail') as string,
				this.getNodeParameter('toName', '') as string,
			),
		],
		subject: this.getNodeParameter('subject') as string,
		[contentKey]: content,
	};

	const additional = this.getNodeParameter('additionalFields', {}) as IDataObject;
	if (additional.replyTo) email.reply_to = address(additional.replyTo as string);
	if (additional.tag) email.tag = additional.tag;
	if (additional.sendTime) {
		email.send_time = Math.floor(new Date(additional.sendTime as string).getTime() / 1000);
	}
	const tracking = (additional.tracking as IDataObject | undefined)?.trackingValues as
		| IDataObject
		| undefined;
	if (tracking) {
		email.tracking = {
			opens: tracking.opens === true,
			clicks: tracking.clicks === true,
			unsubscribes: tracking.unsubscribes === true,
		};
	}

	requestOptions.body = { emails: [email] };
	return requestOptions;
}

async function buildConsentBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const email = this.getNodeParameter('email') as string;
	const name = (this.getNodeParameter('recipientName', '') as string).trim();
	const redirectUrl = this.getNodeParameter('redirectUrl', '') as string;

	const body: IDataObject = {
		domain: this.getNodeParameter('domain') as string,
		emails: [name ? { email, name } : email],
	};
	if (redirectUrl) body.redirect_url = redirectUrl;

	requestOptions.body = body;
	return requestOptions;
}

// --- node ----------------------------------------------------------------

export class GoodSender implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'GoodSender',
		name: 'goodSender',
		icon: 'file:goodsender.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send transactional, custom, and consent emails through GoodSender',
		defaults: {
			name: 'GoodSender',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'goodSenderApi',
				required: true,
			},
		],
		requestDefaults: {
			baseURL: '={{$credentials.baseUrl}}',
			headers: {
				'Content-Type': 'application/json',
			},
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Email',
						value: 'email',
					},
				],
				default: 'email',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['email'],
					},
				},
				options: [
					{
						name: 'Send Template Email',
						value: 'sendTemplate',
						action: 'Send a transactional template email',
						description:
							'Send a predefined transactional template instantly to any recipient. Bypasses the Permission Loop — no consent required.',
						routing: {
							request: { method: 'POST', url: '/v1/emails/template' },
							send: { preSend: [buildTemplateBody] },
						},
					},
					{
						name: 'Send Custom Email',
						value: 'sendCustom',
						action: 'Send a custom email',
						description:
							'Send a custom email. Consent-gated: held until the recipient approves via the Permission Loop, so delivery is NOT guaranteed to be immediate. Only granted, active recipients are delivered; others are declined.',
						routing: {
							request: { method: 'POST', url: '/v1/emails/send' },
							send: { preSend: [buildCustomBody] },
						},
					},
					{
						name: 'Request Consent',
						value: 'requestConsent',
						action: 'Request recipient consent',
						description: 'Ask a recipient to approve future custom email from your domain',
						routing: {
							request: { method: 'POST', url: '/v1/emails/consent' },
							send: { preSend: [buildConsentBody] },
						},
					},
					{
						name: 'Get Consent Status',
						value: 'getConsent',
						action: 'Get a recipient consent status',
						description: 'Get the current consent status for one recipient',
						routing: {
							request: {
								method: 'GET',
								url: '=/v1/emails/{{encodeURIComponent($parameter["email"])}}',
							},
						},
					},
					{
						name: 'List Consents',
						value: 'listConsents',
						action: 'List recipient consent statuses',
						description: 'List recipient consent statuses for a sender domain',
						routing: {
							request: { method: 'GET', url: '/v1/emails' },
						},
					},
					{
						name: 'List Domains',
						value: 'listDomains',
						action: 'List sender domains',
						description: 'List sender domains and their DNS verification state',
						routing: {
							request: { method: 'GET', url: '/v1/domains' },
						},
					},
				],
				default: 'sendTemplate',
			},

			// --- shared sender / recipient (sendTemplate + sendCustom) ---
			{
				displayName: 'From Email',
				name: 'fromEmail',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'you@your-domain.com',
				description: 'Sender address. Must be on a domain you have verified in GoodSender.',
				displayOptions: {
					show: { resource: ['email'], operation: ['sendTemplate', 'sendCustom'] },
				},
			},
			{
				displayName: 'From Name',
				name: 'fromName',
				type: 'string',
				default: '',
				description: 'Optional sender display name shown in the recipient inbox',
				displayOptions: {
					show: { resource: ['email'], operation: ['sendTemplate', 'sendCustom'] },
				},
			},
			{
				displayName: 'To Email',
				name: 'toEmail',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'recipient@example.com',
				description: 'Recipient email address',
				displayOptions: {
					show: { resource: ['email'], operation: ['sendTemplate', 'sendCustom'] },
				},
			},
			{
				displayName: 'To Name',
				name: 'toName',
				type: 'string',
				default: '',
				description: 'Optional recipient display name',
				displayOptions: {
					show: { resource: ['email'], operation: ['sendTemplate', 'sendCustom'] },
				},
			},
			{
				displayName: 'Subject',
				name: 'subject',
				type: 'string',
				required: true,
				default: '',
				description: 'Subject line of the email',
				displayOptions: {
					show: { resource: ['email'], operation: ['sendTemplate', 'sendCustom'] },
				},
			},

			// --- Send Template Email ---
			{
				displayName: 'Template',
				name: 'templateId',
				type: 'options',
				required: true,
				default: 'otp_code',
				description:
					'Predefined transactional template to send. Pick "Custom (By ID)" to use a template ID not listed here.',
				displayOptions: {
					show: { resource: ['email'], operation: ['sendTemplate'] },
				},
				options: [
					{
						name: 'Custom (By ID)',
						value: '__custom__',
						description: 'Specify a template ID not listed above',
					},
					{
						name: 'Email Changed',
						value: 'email_changed',
						description: 'Variables: app_name, new_email, changed_at, additional_info',
					},
					{
						name: 'MFA Enrollment',
						value: 'mfa_enrollment',
						description: 'Variables: app_name, mfa_method, enrolled_at',
					},
					{
						name: 'New Device Login',
						value: 'new_device_login',
						description: 'Variables: app_name, login_time, additional_info',
					},
					{
						name: 'Order Completed',
						value: 'order_completed',
						description: 'Variables: app_name, order_id, order_total, completed_at',
					},
					{
						name: 'Order Receipt',
						value: 'order_receipt',
						description:
							'Variables: app_name, description, receipt_number, purchase_date, payment_method, total',
					},
					{
						name: 'OTP Code',
						value: 'otp_code',
						description:
							'Variables: app_name, otp_code, expiry_minutes, purpose, anti_phishing_notice',
					},
					{
						name: 'Password Changed',
						value: 'password_changed',
						description: 'Variables: app_name, changed_at, additional_info',
					},
				],
			},
			{
				displayName: 'Template ID (Custom)',
				name: 'templateIdCustom',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'welcome',
				description: 'The exact template ID to send. Returns 404 if the template does not exist.',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['__custom__'],
					},
				},
			},
			// Per-template variable fields. Each appears only when its template is
			// selected, so the predefined variables are visible without typing keys.
			// All are optional; blanks are omitted and render as empty strings.
			{
				displayName: 'App Name',
				name: 'app_name',
				type: 'string',
				default: '',
				description: 'Your application or product name shown in the email',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: [
							'otp_code',
							'mfa_enrollment',
							'new_device_login',
							'order_completed',
							'order_receipt',
							'email_changed',
							'password_changed',
						],
					},
				},
			},
			{
				displayName: 'OTP Code',
				name: 'otp_code',
				type: 'string',
				default: '',
				description: 'The one-time passcode to display',
				displayOptions: {
					show: { resource: ['email'], operation: ['sendTemplate'], templateId: ['otp_code'] },
				},
			},
			{
				displayName: 'Expiry Minutes',
				name: 'expiry_minutes',
				type: 'string',
				default: '',
				description: 'How many minutes the code stays valid',
				displayOptions: {
					show: { resource: ['email'], operation: ['sendTemplate'], templateId: ['otp_code'] },
				},
			},
			{
				displayName: 'Purpose',
				name: 'purpose',
				type: 'string',
				default: '',
				description: 'What the code is for (e.g. "signing in")',
				displayOptions: {
					show: { resource: ['email'], operation: ['sendTemplate'], templateId: ['otp_code'] },
				},
			},
			{
				displayName: 'Anti-Phishing Notice',
				name: 'anti_phishing_notice',
				type: 'string',
				default: '',
				description: 'Optional anti-phishing line shown to the recipient',
				displayOptions: {
					show: { resource: ['email'], operation: ['sendTemplate'], templateId: ['otp_code'] },
				},
			},
			{
				displayName: 'MFA Method',
				name: 'mfa_method',
				type: 'string',
				default: '',
				description: 'The MFA method enrolled (e.g. "authenticator app")',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['mfa_enrollment'],
					},
				},
			},
			{
				displayName: 'Enrolled At',
				name: 'enrolled_at',
				type: 'string',
				default: '',
				description: 'When MFA was enabled (human-readable timestamp)',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['mfa_enrollment'],
					},
				},
			},
			{
				displayName: 'Login Time',
				name: 'login_time',
				type: 'string',
				default: '',
				description: 'When the new-device login happened',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['new_device_login'],
					},
				},
			},
			{
				displayName: 'Additional Info',
				name: 'additional_info',
				type: 'string',
				default: '',
				description: 'Extra context shown to the recipient',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['new_device_login', 'email_changed', 'password_changed'],
					},
				},
			},
			{
				displayName: 'Order ID',
				name: 'order_id',
				type: 'string',
				default: '',
				description: 'Your order identifier',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['order_completed'],
					},
				},
			},
			{
				displayName: 'Order Total',
				name: 'order_total',
				type: 'string',
				default: '',
				description: 'The order total, formatted (e.g. "$49.00")',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['order_completed'],
					},
				},
			},
			{
				displayName: 'Completed At',
				name: 'completed_at',
				type: 'string',
				default: '',
				description: 'When the order completed',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['order_completed'],
					},
				},
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				description: 'Short description of the purchase',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['order_receipt'],
					},
				},
			},
			{
				displayName: 'Receipt Number',
				name: 'receipt_number',
				type: 'string',
				default: '',
				description: 'Your receipt number',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['order_receipt'],
					},
				},
			},
			{
				displayName: 'Purchase Date',
				name: 'purchase_date',
				type: 'string',
				default: '',
				description: 'Date of the purchase',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['order_receipt'],
					},
				},
			},
			{
				displayName: 'Payment Method',
				name: 'payment_method',
				type: 'string',
				default: '',
				description: 'Payment method used (e.g. "Visa ****4242")',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['order_receipt'],
					},
				},
			},
			{
				displayName: 'Total',
				name: 'total',
				type: 'string',
				default: '',
				description: 'Amount paid, formatted (e.g. "$49.00")',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['order_receipt'],
					},
				},
			},
			{
				displayName: 'New Email',
				name: 'new_email',
				type: 'string',
				default: '',
				description: 'The new email address the account changed to',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['email_changed'],
					},
				},
			},
			{
				displayName: 'Changed At',
				name: 'changed_at',
				type: 'string',
				default: '',
				description: 'When the change happened',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['email_changed', 'password_changed'],
					},
				},
			},
			// Custom template (By ID): the variable keys are unknown, so keep a
			// freeform key/value list here.
			{
				displayName: 'Variables',
				name: 'customVariables',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Variable',
				default: {},
				description:
					'Key/value pairs that fill the template placeholders. Omitted variables render as empty strings. URL-type variables must point to the sender domain.',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['sendTemplate'],
						templateId: ['__custom__'],
					},
				},
				options: [
					{
						name: 'variable',
						displayName: 'Variable',
						values: [
							{
								displayName: 'Key',
								name: 'key',
								type: 'string',
								default: '',
								placeholder: 'app_name',
								description: 'Variable name as defined by the template',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description: 'Variable value',
							},
						],
					},
				],
			},

			// --- Send Custom Email ---
			{
				displayName: 'Content Type',
				name: 'contentType',
				type: 'options',
				default: 'markdown',
				description: 'Format of the email body',
				displayOptions: {
					show: { resource: ['email'], operation: ['sendCustom'] },
				},
				options: [
					{ name: 'Markdown', value: 'markdown' },
					{ name: 'HTML', value: 'html' },
					{ name: 'Text', value: 'text' },
				],
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				required: true,
				default: '',
				typeOptions: { rows: 6 },
				description: 'Body of the email, in the selected content type',
				displayOptions: {
					show: { resource: ['email'], operation: ['sendCustom'] },
				},
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['email'], operation: ['sendCustom'] },
				},
				options: [
					{
						displayName: 'Reply To Email',
						name: 'replyTo',
						type: 'string',
						default: '',
						description: 'Reply-to email address',
					},
					{
						displayName: 'Send At',
						name: 'sendTime',
						type: 'dateTime',
						default: '',
						description:
							'When to send the email. Must be within 72 hours from now. Leave empty to send immediately.',
					},
					{
						displayName: 'Tag',
						name: 'tag',
						type: 'string',
						default: '',
						description: 'Custom tracking tag (max 100 characters)',
					},
					{
						displayName: 'Tracking',
						name: 'tracking',
						type: 'fixedCollection',
						default: {},
						description: 'Per-email open/click/unsubscribe tracking settings',
						options: [
							{
								name: 'trackingValues',
								displayName: 'Tracking',
								values: [
									{
										displayName: 'Track Opens',
										name: 'opens',
										type: 'boolean',
										default: false,
										description: 'Whether to track email opens',
									},
									{
										displayName: 'Track Clicks',
										name: 'clicks',
										type: 'boolean',
										default: false,
										description: 'Whether to track link clicks',
									},
									{
										displayName: 'Track Unsubscribes',
										name: 'unsubscribes',
										type: 'boolean',
										default: false,
										description: 'Whether to track unsubscribes',
									},
								],
							},
						],
					},
				],
			},

			// --- Request Consent ---
			{
				displayName: 'Domain',
				name: 'domain',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'your-domain.com',
				description: 'Your verified sender domain the consent is for',
				displayOptions: {
					show: { resource: ['email'], operation: ['requestConsent'] },
				},
			},
			{
				displayName: 'Recipient Email',
				name: 'email',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'recipient@example.com',
				description: 'Email address to request consent from',
				displayOptions: {
					show: { resource: ['email'], operation: ['requestConsent'] },
				},
			},
			{
				displayName: 'Recipient Name',
				name: 'recipientName',
				type: 'string',
				default: '',
				description: 'Optional display name stored for this recipient',
				displayOptions: {
					show: { resource: ['email'], operation: ['requestConsent'] },
				},
			},
			{
				displayName: 'Redirect URL',
				name: 'redirectUrl',
				type: 'string',
				default: '',
				placeholder: 'https://your-domain.com/consent/{email}',
				description:
					'URL the recipient is sent to after responding. "{email}" is replaced with their address.',
				displayOptions: {
					show: { resource: ['email'], operation: ['requestConsent'] },
				},
			},

			// --- Get Consent Status ---
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'recipient@example.com',
				description: 'Recipient email address to look up',
				displayOptions: {
					show: { resource: ['email'], operation: ['getConsent'] },
				},
			},
			{
				displayName: 'Filter By Domain',
				name: 'domain',
				type: 'string',
				default: '',
				description: 'Optional sender domain filter. Leave empty to return consent across all domains.',
				displayOptions: {
					show: { resource: ['email'], operation: ['getConsent'] },
				},
				routing: {
					send: { type: 'query', property: 'domain' },
				},
			},

			// --- List Consents ---
			{
				displayName: 'Domain',
				name: 'domain',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'your-domain.com',
				description: 'Sender domain to list consent statuses for',
				displayOptions: {
					show: { resource: ['email'], operation: ['listConsents'] },
				},
				routing: {
					send: { type: 'query', property: 'domain' },
				},
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: { resource: ['email'], operation: ['listConsents'] },
				},
				options: [
					{
						displayName: 'Limit',
						name: 'limit',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 50,
						description: 'Max number of results to return',
						routing: { send: { type: 'query', property: 'limit' } },
					},
					{
						displayName: 'Cursor',
						name: 'cursor',
						type: 'string',
						default: '',
						description: 'Pagination cursor returned as "nextCursor" by a previous call',
						routing: { send: { type: 'query', property: 'cursor' } },
					},
					{
						displayName: 'Consent Status',
						name: 'consentStatus',
						type: 'options',
						default: 'granted',
						description: 'Filter by the recipient consent status',
						routing: { send: { type: 'query', property: 'consentStatus' } },
						options: [
							{ name: 'Denied', value: 'denied' },
							{ name: 'Failed', value: 'failed' },
							{ name: 'Granted', value: 'granted' },
							{ name: 'Pending', value: 'pending' },
							{ name: 'Requested', value: 'requested' },
						],
					},
					{
						displayName: 'Engagement Status',
						name: 'engagementStatus',
						type: 'options',
						default: 'new',
						description: 'Filter by the recipient engagement status',
						routing: { send: { type: 'query', property: 'engagementStatus' } },
						options: [
							{ name: 'Cooling', value: 'cooling' },
							{ name: 'Dormant', value: 'dormant' },
							{ name: 'Hot', value: 'hot' },
							{ name: 'Inactive', value: 'inactive' },
							{ name: 'New', value: 'new' },
							{ name: 'Warm', value: 'warm' },
						],
					},
				],
			},

			// --- List Domains ---
			{
				displayName: 'Filters',
				name: 'domainFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: { resource: ['email'], operation: ['listDomains'] },
				},
				options: [
					{
						displayName: 'Limit',
						name: 'limit',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 50,
						description: 'Max number of results to return',
						routing: { send: { type: 'query', property: 'limit' } },
					},
					{
						displayName: 'Cursor',
						name: 'cursor',
						type: 'string',
						default: '',
						description: 'Pagination cursor returned as "nextCursor" by a previous call',
						routing: { send: { type: 'query', property: 'cursor' } },
					},
				],
			},
		],
	};
}
