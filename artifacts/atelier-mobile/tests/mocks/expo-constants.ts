// Mock expo-constants for the push-fallback probe — mutable per scenario.
export const state: {
  appOwnership: string | null;
  executionEnvironment: string;
  extra: Record<string, unknown>;
  easConfig: { projectId?: string } | undefined;
} = {
  appOwnership: null,
  executionEnvironment: "bare",
  extra: {},
  easConfig: undefined,
};

const Constants = {
  get appOwnership() {
    return state.appOwnership;
  },
  get executionEnvironment() {
    return state.executionEnvironment;
  },
  get expoConfig() {
    return { extra: state.extra };
  },
  get easConfig() {
    return state.easConfig;
  },
};
export default Constants;
