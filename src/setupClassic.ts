import { MonacoEditorLanguageClientWrapper, UserConfig } from 'monaco-editor-wrapper';
import { configureWorker, defineUserServices } from './setupCommon.js';
import monarchSyntax from './syntaxes/agentlang.monarch.js';

export const setupConfigClassic = (): UserConfig => {
  return {
    wrapperConfig: {
      serviceConfig: defineUserServices(),
      editorAppConfig: {
        $type: 'classic',
        languageId: 'agentlang',
        code: `// Agentlang is running in the web!`,
        useDiffEditor: false,
        languageExtensionConfig: { id: 'langium' },
        languageDef: monarchSyntax,
        editorOptions: {
          'semanticHighlighting.enabled': true,
          theme: 'vs-dark',
        },
      },
    },
    languageClientConfig: configureWorker(),
  };
};

export const executeClassic = async (htmlElement: HTMLElement) => {
  const userConfig = setupConfigClassic();
  const wrapper = new MonacoEditorLanguageClientWrapper();
  await wrapper.initAndStart(userConfig, htmlElement);
};
