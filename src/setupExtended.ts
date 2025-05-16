import { MonacoEditorLanguageClientWrapper, type WrapperConfig } from 'monaco-editor-wrapper';

export const setupConfigExtended = () => {
  const extensionFilesOrContents = new Map();
  extensionFilesOrContents.set(
    '/language-configuration.json',
    new URL('../language-configuration.json', import.meta.url)
  );
  extensionFilesOrContents.set(
    '/agentlang-grammar.json',
    new URL('../syntaxes/agentlang.tmLanguage.json', import.meta.url)
  );

  return {
    $type: 'extended',
    editorAppConfig: {
      codeResources: {
        modified: {
          uri: '/workspace/example.al',
          text: `// Agentlang is running in the web!`,
        },
      },
      useDiffEditor: false,
      extensions: [
        {
          config: {
            name: 'agentlang-web',
            publisher: 'generator-langium',
            version: '1.0.0',
            engines: {
              vscode: '*',
            },
            contributes: {
              languages: [
                {
                  id: 'agentlang',
                  extensions: ['.agentlang'],
                  configuration: './language-configuration.json',
                },
              ],
              grammars: [
                {
                  language: 'agentlang',
                  scopeName: 'source.agentlang',
                  path: './agentlang-grammar.json',
                },
              ],
            },
          },
          filesOrContents: extensionFilesOrContents,
        },
      ],
      userConfiguration: {
        json: JSON.stringify({
          'workbench.colorTheme': 'Default Dark Modern',
          'editor.semanticHighlighting.enabled': true,
        }),
      },
    },
  };
};

export const executeExtended = async (htmlElement: HTMLElement) => {
  try {
    const config = setupConfigExtended();
    const wrapper = new MonacoEditorLanguageClientWrapper();

    // Add the HTML container to the config
    const wrapperConfig = {
      ...config,
      htmlContainer: htmlElement,
    } as WrapperConfig;

    // Initialize and start the wrapper
    await wrapper.initAndStart(wrapperConfig);
  } catch (error) {
    console.error('Error initializing monaco editor:', error);
  }
};
