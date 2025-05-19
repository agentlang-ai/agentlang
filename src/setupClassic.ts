import { MonacoEditorLanguageClientWrapper, type WrapperConfig } from 'monaco-editor-wrapper';
import monarchSyntax from './syntaxes/agentlang.monarch.js';

export const setupConfigClassic = () => {
  return {
    $type: 'classic',
    editorAppConfig: {
      codeResources: {
        modified: {
          uri: '/workspace/example.al',
          text: `// Agentlang is running in the web!`,
        },
      },
      useDiffEditor: false,
      languageDef: {
        languageExtensionConfig: { id: 'agentlang' },
        monarchLanguage: monarchSyntax,
      },
      editorOptions: {
        'semanticHighlighting.enabled': true,
        theme: 'vs-dark',
      },
    },
  };
};

export const executeClassic = async (htmlElement: HTMLElement) => {
  try {
    const config = setupConfigClassic();
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
