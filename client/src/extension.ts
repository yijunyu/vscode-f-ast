import * as vscode from 'vscode';
import { workspace, ExtensionContext, commands, Uri, window } from 'vscode';
import { execSync } from 'child_process';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient';

const fs = require("fs");
const path = require('path');
const tempfile = require('tempfile');
const wgetCmd = 'docker run --rm -v $(pwd):/e -v /private:/private -v /tmp:/tmp --entrypoint wget yijun/fast ';
const unzipCmd = 'docker run --rm -v $(pwd):/e -v /private:/private -v /tmp:/tmp --entrypoint unzip yijun/fast ';
const fastCmd = 'docker run --rm -v $(pwd):/e -v /private:/private -v /tmp:/tmp -v ' + vscode.workspace.rootPath + ':' + vscode.workspace.rootPath + ' yijun/fast ';

function updateView3(message, doc, csv_filename, pb_filename, html_filename) {
	vscode.window.showErrorMessage("model: " + message.model + " csv: " + csv_filename + " temp_pb: " + pb_filename);
	var accumulated = "0";
	if (message.attention === "accumulation") 
		accumulated = "1";
	
	execSync(fastCmd + '-p ' + doc + ' ' + pb_filename);
	execSync(fastCmd + '-H 0 -a ' + accumulated + ' -x ' + csv_filename + ' ' + pb_filename + '> ' + html_filename);
	var text = fs.readFileSync(html_filename);
	fs.unlinkSync(pb_filename);
	fs.unlinkSync(html_filename);
	return text;	
}

function fetchModel(model_dir) {
	var zip_filename = tempfile('.zip');
	execSync(wgetCmd + 'https://github.com/yijunyu/vscode-fast/raw/model/model.zip -O ' + zip_filename);
	execSync(unzipCmd + zip_filename + ' -d ' + model_dir);
	fs.unlinkSync(zip_filename);
}

function getWebviewContent3(context: vscode.ExtensionContext, doc: String, message: any) {
	var dirname = path.dirname(doc);
	var ext = path.extname(doc);
	var filename = path.basename(doc, ext);
	var pb_filename = tempfile('.pb');
	var html_filename = tempfile('.html');
	
	// var pb_filename = path.join(dirname, filename + '.pb');
	// var html_filename = path.join(dirname, filename + '.html');
	var csv_filename = path.join(dirname, filename, filename + "_" 
		+ (message.polling != ""? message.polling + "_" : "") 
		+ (message.weight != "" ? message.weight + "_" : "") 
		+ (message.node != "" ? message.node : "")
		+ ".csv");

	return updateView3(message, doc, csv_filename, pb_filename, html_filename);
}

function updateView(model_dir) {
	var models = "";
	var files = fs.readdirSync(model_dir);
	for (var i=0; i <files.length; i++) {
		models = models + `<option value="`+ files[i] + `">` + files[i] + `</option>`;
	}	
	var text = `<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Cat Coding</title>
	</head>
	<body>
		<form id="form">
		Model: 
		<select id="model" name="model">`
		+ models +
		`</select>
		<fieldset>
			<legend>Aggregating method:</legend>
			<input type="radio" name="polling" value=""> None<br>
			<input type="radio" name="polling" value="sum_sigmoid" checked> Sum Sigmoid<br>
			<input type="radio" name="polling" value="sum_softmax"> Sum Softmax<br>
			<input type="radio" name="polling" value="normal"> Normal<br>
			<input type="radio" name="polling" value="accumulation"> Accumulation<br>
		</fieldset>
		<fieldset>
			<legend>Attention method:</legend>
			<input type="radio" name="weight" value="attention_all_1" checked> All 1<br>
			<input type="radio" name="weight" value="raw_attention" checked> Raw<br>
			<input type="radio" name="weight" value="scaled_attention"> Scaled<br>
		</fieldset>
		<fieldset>
			<legend>Node types:</legend>
			<input type="radio" name="node" value="with_node_type_and_subtree_size" checked> With Node Type and Subtree Size<br>
			<input type="radio" name="node" value="only_node_type"> Only Node Type<br>
			<input type="radio" name="node" value="without_node_type"> Without Node Type<br>
		</fieldset>
		</form>
		<div id="message"></div>
		<script>
			const vscode = acquireVsCodeApi();
			function get_value(name) {
				var value = "";
				var x = document.getElementsByName(name);
				for (var i = 0; i < x.length; i++) {
					if (x[i].type == "radio" && x[i].checked) {
						value = x[i].value;
					}
				}
				return value;
			}

			function post(event) {
				var polling = get_value('polling');
				var weight = get_value('weight');
				var node = get_value('node');
				var model_value = model.value;
				vscode.postMessage({
				    polling: polling,
					weight: weight,
					node: node,
					model: model_value
				});
			}
			var x = document.getElementsByTagName('input');
			var i;
			for (i = 0; i < x.length; i++) {
				if (x[i].type == "radio") {
					x[i].onchange = (event) => {post(event)};
				}
			}
			const model = document.getElementById('model');
			const message = document.getElementById('message');
			model.onchange = (event) => {post(event);};
		</script>
	</body>
	</html>`;
	return text;
}

function getWebviewContent(context: vscode.ExtensionContext) {
	var model_dir = vscode.workspace.rootPath + "/model";
	return updateView(model_dir);
}

let client: LanguageClient;

export function activate(context: ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('bigCoding.start', async () => {
			var doc = vscode.window.activeTextEditor.document.fileName;
			// vscode.window.showErrorMessage(doc);

			// Create and show panel
			const panel = vscode.window.createWebviewPanel(
				'Attention to Code: Configuration',
				'Configuration',
				vscode.ViewColumn.Two,
				{	enableScripts: true,
					retainContextWhenHidden: true,
				}
			);
			var model_dir = vscode.workspace.rootPath;
			if (!fs.existsSync(model_dir + "/model")) {
				await fetchModel(model_dir);
			} 		
			// And set its HTML content
			panel.webview.html = getWebviewContent(context);

			// Handle messages from the webview
			panel.webview.onDidReceiveMessage(
				message => {
					const panel = vscode.window.createWebviewPanel(
						'Attention to Code: View',
						path.basename(doc) + "(" 
							+ message.attention + ","
							+ message.weight + "," 
							+ message.node + "," 
							+ message.model + ")",
						vscode.ViewColumn.One,
						{	enableScripts: true,
							retainContextWhenHidden: true,
						}
					);
					panel.webview.html = getWebviewContent3(context, doc, message);
				},
				undefined,
				context.subscriptions
			);
		})
	);

	// The server is implemented in node
	let serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);
	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [{ scheme: 'file', language: 'cpp' }, { scheme: 'file', language: 'java' }, ],
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'languageServerExample',
		'Language Server Example',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
