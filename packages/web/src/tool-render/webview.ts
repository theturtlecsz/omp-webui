/**
 * JSON-safe declarative content that a tool or extension may request the
 * browser host to display. It deliberately contains data only: no JSX,
 * functions, HTML, or executable URLs/actions.
 */

export const MAX_WEBVIEW_STRING_LENGTH = 1_000_000;
export const MAX_WEBVIEW_ARRAY_LENGTH = 10_000;

export type WebViewTone = "neutral" | "info" | "success" | "warning" | "error";
export type WebViewActionStyle = "primary" | "secondary" | "danger";
export type WebViewScalar = string | number | boolean | null;

export interface WebViewAction {
	/** Stable action identifier returned to the host; it has no executable meaning in the schema. */
	id: string;
	label: string;
	style?: WebViewActionStyle;
	disabled?: boolean;
	/** Host-rendered confirmation copy required before dispatching the action. */
	confirm?: string;
}

interface WebViewBase {
	/** Optional short heading supplied to the browser card chrome. */
	title?: string;
	actions?: WebViewAction[];
}

export interface MarkdownWebView extends WebViewBase {
	kind: "markdown";
	markdown: string;
}

export interface CodeWebView extends WebViewBase {
	kind: "code";
	code: string;
	language?: string;
}

/** Supply a unified diff, or the before/after pair from which the host may derive one. */
export interface DiffWebView extends WebViewBase {
	kind: "diff";
	diff?: string;
	before?: string;
	after?: string;
	language?: string;
}

export interface TableWebView extends WebViewBase {
	kind: "table";
	columns: string[];
	rows: WebViewScalar[][];
}

export interface ProgressWebView extends WebViewBase {
	kind: "progress";
	value: number;
	max?: number;
	label?: string;
	detail?: string;
}

export interface KeyValueWebView extends WebViewBase {
	kind: "keyValue";
	entries: Array<{ key: string; value: WebViewScalar }>;
}

export interface ListWebView extends WebViewBase {
	kind: "list";
	items: Array<{ label: string; detail?: string; tone?: WebViewTone }>;
}

export interface LinksWebView extends WebViewBase {
	kind: "links";
	links: Array<{ label: string; href: string; description?: string }>;
}

export interface ArtifactsWebView extends WebViewBase {
	kind: "artifacts";
	artifacts: Array<{
		id: string;
		label: string;
		href?: string;
		mimeType?: string;
		sizeBytes?: number;
	}>;
}

interface WebViewFormFieldBase {
	id: string;
	label: string;
	help?: string;
	required?: boolean;
	disabled?: boolean;
}

export interface TextFormField extends WebViewFormFieldBase {
	kind: "text" | "textarea" | "password";
	placeholder?: string;
	value?: string;
}

export interface SelectFormField extends WebViewFormFieldBase {
	kind: "select";
	value?: string;
	options: Array<{ value: string; label: string; disabled?: boolean }>;
}

export interface CheckboxFormField extends WebViewFormFieldBase {
	kind: "checkbox";
	checked?: boolean;
}

export type WebViewFormField = TextFormField | SelectFormField | CheckboxFormField;

export interface FormWebView extends WebViewBase {
	kind: "form";
	fields: WebViewFormField[];
	/** An opaque host action ID submitted with the form values. */
	submitActionId?: string;
}

export interface StatusWebView extends WebViewBase {
	kind: "status";
	text: string;
	tone?: WebViewTone;
	detail?: string;
}

export type WebView =
	| MarkdownWebView
	| CodeWebView
	| DiffWebView
	| TableWebView
	| ProgressWebView
	| KeyValueWebView
	| ListWebView
	| LinksWebView
	| ArtifactsWebView
	| FormWebView
	| StatusWebView;

export type WebViewValidationResult =
	| { ok: true; value: WebView; error: null }
	| { ok: false; value: null; error: string };

type UnknownRecord = Record<string, unknown>;
type ValidationError = Extract<WebViewValidationResult, { ok: false }>;

function fail(error: string): ValidationError {
	return { ok: false, value: null, error };
}

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(record: UnknownRecord, key: string, path: string, required = false): string | undefined | ValidationError {
	const value = record[key];
	if (value === undefined && !required) return undefined;
	if (typeof value !== "string") return fail(`${path}: must be a string`);
	if (value.length > MAX_WEBVIEW_STRING_LENGTH) {
		return fail(`${path}: exceeds ${MAX_WEBVIEW_STRING_LENGTH} character limit`);
	}
	return value;
}

function booleanAt(record: UnknownRecord, key: string, path: string): boolean | undefined | ValidationError {
	const value = record[key];
	if (value === undefined) return undefined;
	return typeof value === "boolean" ? value : fail(`${path}: must be a boolean`);
}

function finiteNumberAt(record: UnknownRecord, key: string, path: string, required = false): number | undefined | ValidationError {
	const value = record[key];
	if (value === undefined && !required) return undefined;
	return typeof value === "number" && Number.isFinite(value) ? value : fail(`${path}: must be a finite number`);
}

function arrayAt(record: UnknownRecord, key: string, path: string, required = false): unknown[] | undefined | ValidationError {
	const value = record[key];
	if (value === undefined && !required) return undefined;
	if (!Array.isArray(value)) return fail(`${path}: must be an array`);
	if (value.length > MAX_WEBVIEW_ARRAY_LENGTH) return fail(`${path}: exceeds ${MAX_WEBVIEW_ARRAY_LENGTH} entry limit`);
	return value;
}

function isFailure(value: unknown): value is ValidationError {
	return isRecord(value) && value.ok === false && typeof value.error === "string";
}

function commonFields(record: UnknownRecord): Pick<WebViewBase, "title" | "actions"> | ValidationError {
	const title = stringAt(record, "title", "webview.title");
	if (isFailure(title)) return title;
	const actions = validateActions(record.actions, "webview.actions");
	if (isFailure(actions)) return actions;
	return { ...(title === undefined ? {} : { title }), ...(actions === undefined ? {} : { actions }) };
}

function validateActions(value: unknown, path: string): WebViewAction[] | undefined | ValidationError {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) return fail(`${path}: must be an array`);
	if (value.length > MAX_WEBVIEW_ARRAY_LENGTH) return fail(`${path}: exceeds ${MAX_WEBVIEW_ARRAY_LENGTH} entry limit`);
	const actions: WebViewAction[] = [];
	for (let index = 0; index < value.length; index++) {
		const entry = value[index];
		if (!isRecord(entry)) return fail(`${path}[${index}]: must be an object`);
		const id = stringAt(entry, "id", `${path}[${index}].id`, true);
		const label = stringAt(entry, "label", `${path}[${index}].label`, true);
		const style = stringAt(entry, "style", `${path}[${index}].style`);
		const disabled = booleanAt(entry, "disabled", `${path}[${index}].disabled`);
		const confirm = stringAt(entry, "confirm", `${path}[${index}].confirm`);
		if (isFailure(id) || isFailure(label) || isFailure(style) || isFailure(disabled) || isFailure(confirm)) {
				return (isFailure(id) ? id : isFailure(label) ? label : isFailure(style) ? style : isFailure(disabled) ? disabled : confirm) as ValidationError;
		}
		if (style !== undefined && style !== "primary" && style !== "secondary" && style !== "danger") {
			return fail(`${path}[${index}].style: unsupported action style ${JSON.stringify(style)}`);
		}
		actions.push({ id: id as string, label: label as string, ...(style === undefined ? {} : { style }), ...(disabled === undefined ? {} : { disabled }), ...(confirm === undefined ? {} : { confirm }) });
	}
	return actions;
}

function scalar(value: unknown, path: string): WebViewScalar | ValidationError {
	if (value === null || typeof value === "string" || typeof value === "boolean") {
		if (typeof value === "string" && value.length > MAX_WEBVIEW_STRING_LENGTH) {
			return fail(`${path}: exceeds ${MAX_WEBVIEW_STRING_LENGTH} character limit`);
		}
		return value;
	}
	return typeof value === "number" && Number.isFinite(value) ? value : fail(`${path}: must be a JSON scalar`);
}

function toneAt(record: UnknownRecord, key: string, path: string): WebViewTone | undefined | ValidationError {
	const value = stringAt(record, key, path);
	if (isFailure(value) || value === undefined) return value;
	return value === "neutral" || value === "info" || value === "success" || value === "warning" || value === "error"
		? value
		: fail(`${path}: unsupported tone ${JSON.stringify(value)}`);
}

function validateFormFields(value: unknown): WebViewFormField[] | ValidationError {
	if (!Array.isArray(value)) return fail("webview.fields: must be an array");
	if (value.length > MAX_WEBVIEW_ARRAY_LENGTH) return fail(`webview.fields: exceeds ${MAX_WEBVIEW_ARRAY_LENGTH} entry limit`);
	const fields: WebViewFormField[] = [];
	for (let index = 0; index < value.length; index++) {
		const entry = value[index];
		const path = `webview.fields[${index}]`;
		if (!isRecord(entry)) return fail(`${path}: must be an object`);
		const kind = stringAt(entry, "kind", `${path}.kind`, true);
		const id = stringAt(entry, "id", `${path}.id`, true);
		const label = stringAt(entry, "label", `${path}.label`, true);
		const help = stringAt(entry, "help", `${path}.help`);
		const required = booleanAt(entry, "required", `${path}.required`);
		const disabled = booleanAt(entry, "disabled", `${path}.disabled`);
		if (isFailure(kind) || isFailure(id) || isFailure(label) || isFailure(help) || isFailure(required) || isFailure(disabled)) {
				return (isFailure(kind) ? kind : isFailure(id) ? id : isFailure(label) ? label : isFailure(help) ? help : isFailure(required) ? required : disabled) as ValidationError;
		}
		const base = { id: id as string, label: label as string, ...(help === undefined ? {} : { help }), ...(required === undefined ? {} : { required }), ...(disabled === undefined ? {} : { disabled }) };
		if (kind === "text" || kind === "textarea" || kind === "password") {
			const placeholder = stringAt(entry, "placeholder", `${path}.placeholder`);
			const fieldValue = stringAt(entry, "value", `${path}.value`);
				if (isFailure(placeholder) || isFailure(fieldValue)) return (isFailure(placeholder) ? placeholder : fieldValue) as ValidationError;
			fields.push({ kind, ...base, ...(placeholder === undefined ? {} : { placeholder }), ...(fieldValue === undefined ? {} : { value: fieldValue }) });
			continue;
		}
		if (kind === "checkbox") {
			const checked = booleanAt(entry, "checked", `${path}.checked`);
			if (isFailure(checked)) return checked;
			fields.push({ kind, ...base, ...(checked === undefined ? {} : { checked }) });
			continue;
		}
		if (kind !== "select") return fail(`${path}.kind: unsupported form field kind ${JSON.stringify(kind)}`);
		const fieldValue = stringAt(entry, "value", `${path}.value`);
		const options = arrayAt(entry, "options", `${path}.options`, true);
			if (isFailure(fieldValue) || isFailure(options)) return (isFailure(fieldValue) ? fieldValue : options) as ValidationError;
		const parsedOptions: SelectFormField["options"] = [];
		for (let optionIndex = 0; optionIndex < (options as unknown[]).length; optionIndex++) {
			const option = (options as unknown[])[optionIndex];
			const optionPath = `${path}.options[${optionIndex}]`;
			if (!isRecord(option)) return fail(`${optionPath}: must be an object`);
			const optionValue = stringAt(option, "value", `${optionPath}.value`, true);
			const optionLabel = stringAt(option, "label", `${optionPath}.label`, true);
			const optionDisabled = booleanAt(option, "disabled", `${optionPath}.disabled`);
			if (isFailure(optionValue) || isFailure(optionLabel) || isFailure(optionDisabled)) {
					return (isFailure(optionValue) ? optionValue : isFailure(optionLabel) ? optionLabel : optionDisabled) as ValidationError;
			}
			parsedOptions.push({ value: optionValue as string, label: optionLabel as string, ...(optionDisabled === undefined ? {} : { disabled: optionDisabled }) });
		}
		fields.push({ kind, ...base, options: parsedOptions, ...(fieldValue === undefined ? {} : { value: fieldValue }) });
	}
	return fields;
}

/**
 * Detailed validator that exposes stable, testable reasons while preserving the
 * simple `validateWebView(input): WebView | null` public entry point.
 */
export function validateWebViewDetailed(input: unknown): WebViewValidationResult {
	try {
		if (!isRecord(input)) return fail("webview: must be an object");
		const kind = stringAt(input, "kind", "webview.kind", true);
		if (isFailure(kind)) return kind;
		const common = commonFields(input);
		if (isFailure(common)) return common;
		switch (kind) {
			case "markdown": {
				const markdown = stringAt(input, "markdown", "webview.markdown", true);
				return isFailure(markdown) ? markdown : { ok: true, value: { kind, ...common, markdown: markdown as string }, error: null };
			}
			case "code": {
				const code = stringAt(input, "code", "webview.code", true);
				const language = stringAt(input, "language", "webview.language");
				if (isFailure(code) || isFailure(language)) return (isFailure(code) ? code : language) as WebViewValidationResult;
				return { ok: true, value: { kind, ...common, code: code as string, ...(language === undefined ? {} : { language }) }, error: null };
			}
			case "diff": {
				const diff = stringAt(input, "diff", "webview.diff");
				const before = stringAt(input, "before", "webview.before");
				const after = stringAt(input, "after", "webview.after");
				const language = stringAt(input, "language", "webview.language");
				if (isFailure(diff) || isFailure(before) || isFailure(after) || isFailure(language)) return (isFailure(diff) ? diff : isFailure(before) ? before : isFailure(after) ? after : language) as WebViewValidationResult;
				if (diff === undefined && (before === undefined || after === undefined)) return fail("webview.diff: requires diff or both before and after");
				return { ok: true, value: { kind, ...common, ...(diff === undefined ? {} : { diff }), ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }), ...(language === undefined ? {} : { language }) }, error: null };
			}
			case "table": {
				const columns = arrayAt(input, "columns", "webview.columns", true);
				const rows = arrayAt(input, "rows", "webview.rows", true);
				if (isFailure(columns) || isFailure(rows)) return (isFailure(columns) ? columns : rows) as WebViewValidationResult;
				const parsedColumns: string[] = [];
				for (let index = 0; index < (columns as unknown[]).length; index++) {
					const value = (columns as unknown[])[index];
					if (typeof value !== "string") return fail(`webview.columns[${index}]: must be a string`);
					if (value.length > MAX_WEBVIEW_STRING_LENGTH) return fail(`webview.columns[${index}]: exceeds ${MAX_WEBVIEW_STRING_LENGTH} character limit`);
					parsedColumns.push(value);
				}
				const parsedRows: WebViewScalar[][] = [];
				let cellCount = 0;
				for (let rowIndex = 0; rowIndex < (rows as unknown[]).length; rowIndex++) {
					const row = (rows as unknown[])[rowIndex];
					if (!Array.isArray(row)) return fail(`webview.rows[${rowIndex}]: must be an array`);
					if (row.length > MAX_WEBVIEW_ARRAY_LENGTH) return fail(`webview.rows[${rowIndex}]: exceeds ${MAX_WEBVIEW_ARRAY_LENGTH} entry limit`);
					cellCount += row.length;
					if (cellCount > MAX_WEBVIEW_ARRAY_LENGTH) return fail(`webview.rows: exceeds ${MAX_WEBVIEW_ARRAY_LENGTH} total cell limit`);
					const parsedRow: WebViewScalar[] = [];
					for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
						const value = scalar(row[cellIndex], `webview.rows[${rowIndex}][${cellIndex}]`);
						if (isFailure(value)) return value;
						parsedRow.push(value);
					}
					parsedRows.push(parsedRow);
				}
				return { ok: true, value: { kind, ...common, columns: parsedColumns, rows: parsedRows }, error: null };
			}
			case "progress": {
				const value = finiteNumberAt(input, "value", "webview.value", true);
				const max = finiteNumberAt(input, "max", "webview.max");
				const label = stringAt(input, "label", "webview.label");
				const detail = stringAt(input, "detail", "webview.detail");
				if (isFailure(value) || isFailure(max) || isFailure(label) || isFailure(detail)) return (isFailure(value) ? value : isFailure(max) ? max : isFailure(label) ? label : detail) as WebViewValidationResult;
				if (max !== undefined && max <= 0) return fail("webview.max: must be greater than zero");
				return { ok: true, value: { kind, ...common, value: value as number, ...(max === undefined ? {} : { max }), ...(label === undefined ? {} : { label }), ...(detail === undefined ? {} : { detail }) }, error: null };
			}
			case "keyValue": {
				const entries = arrayAt(input, "entries", "webview.entries", true);
				if (isFailure(entries)) return entries;
				const parsedEntries: KeyValueWebView["entries"] = [];
				for (let index = 0; index < (entries as unknown[]).length; index++) {
					const entry = (entries as unknown[])[index];
					if (!isRecord(entry)) return fail(`webview.entries[${index}]: must be an object`);
					const key = stringAt(entry, "key", `webview.entries[${index}].key`, true);
					const value = scalar(entry.value, `webview.entries[${index}].value`);
					if (isFailure(key) || isFailure(value)) return (isFailure(key) ? key : value) as WebViewValidationResult;
					parsedEntries.push({ key: key as string, value });
				}
				return { ok: true, value: { kind, ...common, entries: parsedEntries }, error: null };
			}
			case "list": {
				const items = arrayAt(input, "items", "webview.items", true);
				if (isFailure(items)) return items;
				const parsedItems: ListWebView["items"] = [];
				for (let index = 0; index < (items as unknown[]).length; index++) {
					const entry = (items as unknown[])[index];
					if (!isRecord(entry)) return fail(`webview.items[${index}]: must be an object`);
					const label = stringAt(entry, "label", `webview.items[${index}].label`, true);
					const detail = stringAt(entry, "detail", `webview.items[${index}].detail`);
					const tone = toneAt(entry, "tone", `webview.items[${index}].tone`);
					if (isFailure(label) || isFailure(detail) || isFailure(tone)) return (isFailure(label) ? label : isFailure(detail) ? detail : tone) as WebViewValidationResult;
					parsedItems.push({ label: label as string, ...(detail === undefined ? {} : { detail }), ...(tone === undefined ? {} : { tone }) });
				}
				return { ok: true, value: { kind, ...common, items: parsedItems }, error: null };
			}
			case "links": {
				const links = arrayAt(input, "links", "webview.links", true);
				if (isFailure(links)) return links;
				const parsedLinks: LinksWebView["links"] = [];
				for (let index = 0; index < (links as unknown[]).length; index++) {
					const entry = (links as unknown[])[index];
					if (!isRecord(entry)) return fail(`webview.links[${index}]: must be an object`);
					const label = stringAt(entry, "label", `webview.links[${index}].label`, true);
					const href = stringAt(entry, "href", `webview.links[${index}].href`, true);
					const description = stringAt(entry, "description", `webview.links[${index}].description`);
					if (isFailure(label) || isFailure(href) || isFailure(description)) return (isFailure(label) ? label : isFailure(href) ? href : description) as WebViewValidationResult;
					parsedLinks.push({ label: label as string, href: href as string, ...(description === undefined ? {} : { description }) });
				}
				return { ok: true, value: { kind, ...common, links: parsedLinks }, error: null };
			}
			case "artifacts": {
				const artifacts = arrayAt(input, "artifacts", "webview.artifacts", true);
				if (isFailure(artifacts)) return artifacts;
				const parsedArtifacts: ArtifactsWebView["artifacts"] = [];
				for (let index = 0; index < (artifacts as unknown[]).length; index++) {
					const entry = (artifacts as unknown[])[index];
					if (!isRecord(entry)) return fail(`webview.artifacts[${index}]: must be an object`);
					const id = stringAt(entry, "id", `webview.artifacts[${index}].id`, true);
					const label = stringAt(entry, "label", `webview.artifacts[${index}].label`, true);
					const href = stringAt(entry, "href", `webview.artifacts[${index}].href`);
					const mimeType = stringAt(entry, "mimeType", `webview.artifacts[${index}].mimeType`);
					const sizeBytes = finiteNumberAt(entry, "sizeBytes", `webview.artifacts[${index}].sizeBytes`);
					if (isFailure(id) || isFailure(label) || isFailure(href) || isFailure(mimeType) || isFailure(sizeBytes)) return (isFailure(id) ? id : isFailure(label) ? label : isFailure(href) ? href : isFailure(mimeType) ? mimeType : sizeBytes) as WebViewValidationResult;
					if (sizeBytes !== undefined && sizeBytes < 0) return fail(`webview.artifacts[${index}].sizeBytes: must not be negative`);
					parsedArtifacts.push({ id: id as string, label: label as string, ...(href === undefined ? {} : { href }), ...(mimeType === undefined ? {} : { mimeType }), ...(sizeBytes === undefined ? {} : { sizeBytes }) });
				}
				return { ok: true, value: { kind, ...common, artifacts: parsedArtifacts }, error: null };
			}
			case "form": {
				const fields = validateFormFields(input.fields);
				const submitActionId = stringAt(input, "submitActionId", "webview.submitActionId");
				if (isFailure(fields) || isFailure(submitActionId)) return (isFailure(fields) ? fields : submitActionId) as WebViewValidationResult;
				return { ok: true, value: { kind, ...common, fields, ...(submitActionId === undefined ? {} : { submitActionId }) }, error: null };
			}
			case "status": {
				const text = stringAt(input, "text", "webview.text", true);
				const tone = toneAt(input, "tone", "webview.tone");
				const detail = stringAt(input, "detail", "webview.detail");
				if (isFailure(text) || isFailure(tone) || isFailure(detail)) return (isFailure(text) ? text : isFailure(tone) ? tone : detail) as WebViewValidationResult;
				return { ok: true, value: { kind, ...common, text: text as string, ...(tone === undefined ? {} : { tone }), ...(detail === undefined ? {} : { detail }) }, error: null };
			}
			default:
				return fail(`webview.kind: unsupported kind ${JSON.stringify(kind)}`);
		}
	} catch {
		// Getters/proxies are not JSON-safe input. Do not let an extension payload crash the transcript.
		return fail("webview: could not safely inspect input");
	}
}

/** Returns a sanitized, typed WebView or null. Use validateWebViewDetailed for a reason. */
export function validateWebView(input: unknown): WebView | null {
	const validation = validateWebViewDetailed(input);
	return validation.ok ? validation.value : null;
}

/** Convenience seam for UI telemetry and unit tests that need the rejection reason only. */
export function webViewValidationError(input: unknown): string | null {
	const validation = validateWebViewDetailed(input);
	return validation.ok ? null : validation.error;
}
