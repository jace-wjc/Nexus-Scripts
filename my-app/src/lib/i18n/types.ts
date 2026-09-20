// i18n Type Definitions

export type Language = 'zh-CN' | 'en-US';

export interface Translations {
  // Common
  common: {
    loading: string;
    confirm: string;
    cancel: string;
    save: string;
    delete: string;
    edit: string;
    add: string;
    search: string;
    back: string;
    prev: string;
    next: string;
    close: string;
    copy: string;
    copied: string;
    success: string;
    failed: string;
    error: string;
    warning: string;
    info: string;
    yes: string;
    no: string;
    ok: string;
    reset: string;
    clear: string;
    refresh: string;
    refreshing: string;
    submit: string;
    unknownError: string;
    required: string;
    notSelected: string;
    pagination: {
      prefix: string;
      suffix: string;
      separator: string;
    };
    // Additional common texts
    skillsBelongToAdminSettings: string;
    skillsSettingsHint: string;
    noDescription: string;
    noSkills: string;
    skillsEmptyHint: string;
    loadingSkills: string;
    sortOrder: string;
    // Model settings
    modelConfigCenter: string;
    modelConfigHint: string;
    currentChatModel: string;
    currentChatSource: string;
    totalModels: string;
    modelFallbackHint: string;
    currentActive: string;
    priorityLabel: string;
    modelName: string;
    resolvedSource: string;
    maxConcurrency: string;
    maxQps: string;
    sharedModelThrottleHint: string;
    currentlyActive: string;
    setAsCurrent: string;
    noModelConfigs: string;
    noModelConfigsHint: string;
    unrecognized: string;
    refreshModels: string;
    // Mail settings
    mailConfigCenter: string;
    mailConfigHint: string;
    loadingMailCenter: string;
    globalAutoSendDefaults: string;
    globalAutoSendHint: string;
    enableSystemAutoSend: string;
    globalDefaultRecipients: string;
    currentDefaultEmails: string;
    notSet: string;
    saving: string;
    saveDefaults: string;
    senders: string;
    sendersHint: string;
    default: string;
    username: string;
    noSenders: string;
    noSendersHint: string;
    recipients: string;
    recipientsLabel: string;
    recipientsHint: string;
    noDepartment: string;
    noRole: string;
    noRecipients: string;
    noRecipientsHint: string;
    deliveryRecords: string;
    deliveryRecordsHint: string;
    recipient: string;
    candidate: string;
    noCustomSubject: string;
    defaultSender: string;
    automatic: string;
    manual: string;
    triggerScreeningCompleted: string;
    canResend: string;
    unrecorded: string;
    sourcePosition: string;
    position: string;
    candidates: string;
    noLinkedPosition: string;
    triggerStatus: string;
    defaultEmailBodyHint: string;
    retrying: string;
    retryFailedSend: string;
    sendAgain: string;
    noDeliveryRecords: string;
    noDeliveryRecordsHint: string;
  };

  serverMonitoring: {
    title: string;
    back: string;
    // Status
    live: string;
    offline: string; // Added just in case
    // Actions
    pause: string;
    resume: string;
    refresh: string;
    interval: string;
    // Metrics Labels
    cpuLoad: string;
    coresActive: string;
    memory: string;
    netInOut: string;
    sysLoad: string;
    cpuHistory: string;
    memTrend: string;
    coreMap: string;
    diskUsage: string;
    sysInfo: string;
    // Data Labels
    total: string;
    idle: string;
    active: string;
    heavy: string;
    lowSpace: string;
    used: string;
    hostname: string;
    os: string;
    kernel: string;
    uptime: string;
    server: string;
  };

  // Auth / Login
  auth: {
    title: string;
    description: string;
    keyPlaceholder: string;
    loginButton: string;
    verifying: string;
    invalidKey: string;
    enterKey: string;
    verifySuccess: string;
  };

  // Lock Screen
  lock: {
    title: string;
    description: string;
    unlockPlaceholder: string;
    unlockButton: string;
    switchAccount: string;
    unlockSuccess: string;
    autoLockMessage: string;
    wrongKey: string;
    wrongAccount: string;
    emptyKey: string;
    networkError: string;
    serverError: string;
  };

  // Navigation & Layout
  nav: {
    home: string;
    cmTools: string;
    ocrTool: string;
    teamResources: string;
    aiResources: string;
    accessControl: string;
    helpCenter: string;
    systemLogs: string;
    logout: string;
    workspace: string;
    support: string;
    account: string;
    systemRunning: string;
    serviceNormal: string;
    allNodesOnline: string;
    opsCenter: string;
    aiRecruitment: string;
    aiRecruitmentWorkspace: string;
    aiRecruitmentPositions: string;
    aiRecruitmentCandidates: string;
    aiRecruitmentReviewWorkbench: string;
    aiRecruitmentInterviews: string;
    aiRecruitmentTalentPool: string;
    aiRecruitmentAudit: string;
    aiRecruitmentAssistant: string;
  };

  // Header
  header: {
    searchPlaceholder: string;
    noResults: string;
    helpTitle: string;
    lockTitle: string;
    online: string;
    organization: string;
  };

  // Home Page
  home: {
    greetingMorning: string;
    greetingNoon: string;
    greetingAfternoon: string;
    greetingEvening: string;
    greetingNight: string;
    systemNormal: string;
    availableResources: string;
    ready: string;
    systemHealth: string;
    stable: string;
    detecting: string;
    detectFailed: string;
    issues: string;
    totalExecuted: string;
    completed: string;
    cmSystem: {
      title: string;
      description: string;
      running: string;
      enterButton: string;
    };
    hsSystem: {
      title: string;
      description: string;
      planning: string;
      enterButton: string;
    };
    search: {
      cm: {
        name: string;
        desc: string;
      };
      hs: {
        name: string;
        desc: string;
      };
      ops: {
        name: string;
        desc: string;
      };
      accessControl: {
        name: string;
        desc: string;
      };
    };
    devTools: {
      title: string;
      toolset: string;
      description: string;
      enterButton: string;
      planning: string;
    };
  };

  // Scripts config (names and descriptions for systems and scripts)
  scriptConfig: {
    systems: {
      chunmiao: {
        name: string;
        description: string;
      };
      haoshi: {
        name: string;
        description: string;
      };
    };
    items: {
      settlement: { name: string; description: string; };
      commission: { name: string; description: string; };
      balance: { name: string; description: string; };
      taskAutomation: { name: string; description: string; };
      smsOperationsCenter: { name: string; description: string; };
      taxReporting: { name: string; description: string; };
      taxCalculation: { name: string; description: string; };
      settlementSim: { name: string; description: string; };
      paymentStats: { name: string; description: string; };
      deliveryTool: { name: string; description: string; };
      serverMonitoring: { name: string; description: string; };
      bizSceneTask: { name: string; description: string; };
    };
  };

  // Time Chip
  timeChip: {
    greetings: {
      night: string;
      morning: string;
      noon: string;
      afternoon: string;
      evening: string;
    };
  };

  // Weather Chip
  weatherChip: {
    defaultCity: string;
    loading: string;
    unavailable: string;
    refreshing: string;
    refreshWeather: string;
  };

  // Team Resources
  teamResources: {
    loading: string;
    back: string;
    saveSuccess: string;
    saveFail: string;
    sessionTimeout: string;
    // ResourceLock
    title: string;
    lockDescription: string;
    keyPlaceholder: string;
    verifying: string;
    unlock: string;
    verifySuccess: string;
    invalidKey: string;
    accessBadge: string;
    accessHint: string;
    accessFieldLabel: string;
    accessFieldHelp: string;
    overviewCardTitle: string;
    overviewCardDescription: string;
    healthCardDescription: string;
    manageCardDescription: string;
    // ResourceViewer
    viewerTitle: string;
    searchPlaceholder: string;
    healthCheck: string;
    manageResources: string;
    lock: string;
    systems: string;
    searchResults: string;
    manageDescription: string;
    noSystems: string;
    noSystemsInGroup: string;
    addSystem: string;
    // Envs
    envDev: string;
    envTest: string;
    envProd: string;
    // SystemCard
    noDescription: string;
    noCredentials: string;
    envNotConfigured: string;
    contentEmpty: string;
    copiedLabel: string;
    username: string;
    password: string;
    notSet: string;
    passwordProtected: string;
    passwordLoadFailed: string;
    // HealthCheckPanel
    healthCheckTitle: string;
    healthCheckDesc: string;
    systemsCount: string;
    envsToCheck: string;
    startCheck: string;
    checking: string;
    progressLabel: string;
    clickToStart: string;
    needAttention: string;
    needFocus: string;
    statusNormal: string;
    statusWarning: string;
    statusDanger: string;
    statusUnknown: string;
    accessible: string;
    inaccessible: string;
    expired: string;
    expiresIn: string;
    daysRemaining: string;
    clearedEnv: string;
    // ResourceEditor
    resourceManage: string;
    cancel: string;
    saving: string;
    saveChanges: string;
    groupList: string;
    systemList: string;
    groupName: string;
    logoOptional: string;
    clickToUpload: string;
    logoUploaded: string;
    imageTooLarge: string;
    noSystemsAddHint: string;
    selectSystemToEdit: string;
    systemName: string;
    descriptionLabel: string;
    optional: string;
    newGroup: string;
    newSystem: string;
    newAccount: string;
    keepOneGroup: string;
    devEnv: string;
    testEnv: string;
    prodEnv: string;
    accessUrl: string;
    credentialList: string;
    addCredential: string;
    labelPlaceholder: string;
    usernamePlaceholder: string;
    passwordOptional: string;
    noCredentialsYet: string;
    clearThisEnv: string;
    skipHealthCheck: string;
    skipCertCheck: string;
    // Export
    exportResources: string;
    exportFileName: string;
    exportHeader: string;
    exportGeneratedAt: string;
    exportGroup: string;
    exportSystem: string;
    exportDescription: string;
    exportCredentials: string;
    exportSuccess: string;
    // Container
    networkTimeout: string;
    loadError: string;
    reload: string;
    logoReadFailed: string;
    unsavedChangesConfirm: string;
  };

  // Header Health Indicator
  headerHealth: {
    checking: string;
    checkFailed: string;
    retryTooltip: string;
    issues: string;
    certIssues: string;
    recheck: string;
    inaccessible: string;
    expired: string;
    days: string;
    allHealthy: string;
    statusTitle: string;
    allSystemsNormal: string;
    envsChecked: string;
  };

  // AI Resources
  aiResources: {
    title: string;
    back: string;
    searchPlaceholder: string;
    allCategory: string;
    noResults: string;
    downloadIcons: string;
    manage: string;
    saveSuccess: string;
    saveFail: string;
    allIconsExist: string;
    downloadComplete: string;
    // AIResourceEditor
    manageTitle: string;
    cancel: string;
    save: string;
    deleteIcons: string;
    resourcesTab: string;
    categoriesTab: string;
    addResource: string;
    allCategories: string;
    name: string;
    description: string;
    category: string;
    url: string;
    actions: string;
    noResourcesFound: string;
    categoryList: string;
    addCategory: string;
    icon: string;
    order: string;
    resourceCount: string;
    confirmDeleteResource: string;
    confirmDeleteCategory: string;
    categoryHasResources: string;
    deletedIcons: string;
    // Resource modal
    addResourceTitle: string;
    editResourceTitle: string;
    nameRequired: string;
    namePlaceholder: string;
    descriptionPlaceholder: string;
    urlRequired: string;
    urlPlaceholder: string;
    iconLabel: string;
    iconSavePath: string;
    iconUploadSuccess: string;
    uploadFailed: string;
    tagsLabel: string;
    tagsPlaceholder: string;
    orderLabel: string;
    nameOrUrlEmpty: string;
    // Category modal
    addCategoryTitle: string;
    editCategoryTitle: string;
    categoryNamePlaceholder: string;
    categoryNameEmpty: string;
    deleteIcon: string;
    undoDelete: string;
    selectImage: string;
  };

  // System Page
  system: {
    scriptsCount: string;
    searchPlaceholder: string;
    searchHint: string;
    noScripts: string;
    launchScript: string;
  };

  // Help Page
  helpPage: {
    title: string;
    listTitle: string;
    selectDocPlaceholder: string;
    openInNewWindow: string;
    docs: {
      sigGuide: string;
      ocrGuide: string;
    };
  };

  accessControl: {
    title: string;
    subtitle: string;
    governanceConsole: string;
    navOverview: string;
    navOrganizations: string;
    navUsers: string;
    navRoles: string;
    navResources: string;
    navAudit: string;
    refresh: string;
    addUser: string;
    searchPlaceholder: string;
    usersTitle: string;
    usersDesc: string;
    usersGovernanceHint: string;
    fourLayerModel: string;
    organizationsPageTitle: string;
    organizationsPageDesc: string;
    organizationHierarchyHint: string;
    organizationChildrenCount: string;
    organizationChildren: string;
    expandAll: string;
    collapseAll: string;
    organizationsSearchPlaceholder: string;
    createOrganization: string;
    editOrganization: string;
    disableOrganization: string;
    disableOrganizationTitle: string;
    disableOrganizationDesc: string;
    softDeleteOrganization: string;
    softDeleteOrganizationTitle: string;
    softDeleteOrganizationDesc: string;
    organizationSoftDeleted: string;
    organizationSoftDeleteFailed: string;
    errorOrganizationHasChildren: string;
    viewOrgUsers: string;
    viewOrgUsersTitle: string;
    orgPrimaryUsers: string;
    orgDataScopeUsers: string;
    orgNoUsers: string;
    orgUserSummary: string;
    orgUserCode: string;
    orgUserDisplayName: string;
    orgUserStatus: string;
    noOrganizations: string;
    organizationCode: string;
    organizationName: string;
    organizationType: string;
    parentOrganization: string;
    noParentOrganization: string;
    organizationPath: string;
    sortOrder: string;
    organizationFormDesc: string;
    organizationCreated: string;
    organizationUpdated: string;
    organizationDeleted: string;
    organizationSaveFailed: string;
    organizationDeleteFailed: string;
    validationOrgCodePattern: string;
    validationOrgNameRequired: string;
    validationOrgTypeInvalid: string;
    orgTypeGroup: string;
    orgTypeSubGroup: string;
    orgTypeCompany: string;
    orgTypeDepartment: string;
    totalUsers: string;
    totalRoles: string;
    activeUsers: string;
    systemRoles: string;
    dataScopeDistribution: string;
    dataScopeDistributionDesc: string;
    highRiskConfigSummary: string;
    highRiskConfigSummaryDesc: string;
    noHighRiskUsers: string;
    roleDirectorySummary: string;
    roleDirectorySummaryDesc: string;
    resourceDomainSummary: string;
    resourceDomainSummaryDesc: string;
    resourceDomainReadyHint: string;
    resourceDomainPending: string;
    catalogTitle: string;
    rolesTitle: string;
    rolesPageDesc: string;
    rolesSearchPlaceholder: string;
    roleDirectoryTitle: string;
    roleDirectoryOnlyPermissions: string;
    roleFilterAll: string;
    addLabel: string;
    permissionCountUnit: string;
    userCountUnit: string;
    noRoles: string;
    permissionsTitle: string;
    createRole: string;
    editRole: string;
    cloneSystemRole: string;
    saveAsCustomRole: string;
    viewPermissions: string;
    roleCode: string;
    roleName: string;
    roleDescription: string;
    roleDescriptionPlaceholder: string;
    roleType: string;
    roleFormDescription: string;
    roleFormBasicInfo: string;
    roleFormBoundaryHint: string;
    systemRoleCloneHint: string;
    systemRoleReadonlyHint: string;
    rolePermissionOnlyHint: string;
    selectedLabel: string;
    legacyPermissionCount: string;
    roleNoPermissions: string;
    assignPermissions: string;
    permissionGroupNavigation: string;
    selectPermissionGroup: string;
    deselectPermissionGroup: string;
    selectAll: string;
    deselectAll: string;
    landingPageLabel: string;
    landingPageFirstMenu: string;
    landingPageHome: string;
    landingPageWelcome: string;
    landingPageHint: string;
    recruitmentMenuGroupedLabel: string;
    recruitmentMenuGroupedHint: string;
    recruitmentMenuGroupedShort: string;
    recruitmentMenuFlatShort: string;
    systemRole: string;
    customRole: string;
    copySuffix: string;
    assignedUsers: string;
    disableRole: string;
    roleCreated: string;
    roleUpdated: string;
    roleSaveFailed: string;
    unsavedRoleTitle: string;
    unsavedRoleDescription: string;
    continueEditing: string;
    discardChanges: string;
    validationRoleCodeRequired: string;
    validationRoleCodePattern: string;
    validationRoleNameRequired: string;
    validationRolePermissionRequired: string;
    noUsers: string;
    createTitle: string;
    editTitle: string;
    rotateKeyTitle: string;
    generatedKey: string;
    generatedKeyHint: string;
    copyKey: string;
    userCode: string;
    displayName: string;
    organization: string;
    dataScope: string;
    dataScopeAll: string;
    dataScopeOrgAndChildren: string;
    dataScopeOrgOnly: string;
    dataScopeCustomOrgs: string;
    dataScopeSelf: string;
    customOrgs: string;
    customOrgsHelp: string;
    authBoundary: string;
    authorizationBoundary: string;
    authorizationBoundaryHelp: string;
    canGrant: string;
    canGrantHelp: string;
    boundaryEmptyWarning: string;
    manageableOrganizations: string;
    manageableOrganizationsHelp: string;
    assignableRoles: string;
    assignableRolesHelp: string;
    assignablePermissions: string;
    assignablePermissionsHelp: string;
    maxGrantableDataScope: string;
    maxGrantableDataScopeHelp: string;
    organizationCountUnit: string;
    roleCountUnit: string;
    boundaryNoOrgLimit: string;
    boundaryNoRoleLimit: string;
    boundaryNoPermissionLimit: string;
    addPermissionRange: string;
    collapsePermissionRange: string;
    permissionRangeEditorHelp: string;
    orgGovernance: string;
    orgGovernanceDesc: string;
    scopeDowngradeConfirm: string;
    scopeDowngradeConfirmDesc: string;
    userFormDescription: string;
    userFormBasicInfo: string;
    userFormBasicInfoDesc: string;
    userFormOrganizationAndDataScope: string;
    userFormOrganizationAndDataScopeDesc: string;
    userFormOrganization: string;
    userFormDataScope: string;
    userFormDataScopeDesc: string;
    userFormRolesAndPermissions: string;
    userFormConfigPermission: string;
    userFormConfigPermissionDesc: string;
    userFormAccountStatus: string;
    accountActiveTitle: string;
    accountActiveDesc: string;
    accountSuperAdminTitle: string;
    accountSuperAdminDesc: string;
    cannotGrant: string;
    userFormStatusNotes: string;
    userFormStatusNotesDesc: string;
    accessKey: string;
    accessKeyHint: string;
    teamResourcesLoginKey: string;
    teamResourcesLoginKeyHelp: string;
    teamResourcesLoginKeyEnabled: string;
    teamResourcesLoginKeyDisabled: string;
    teamResourcesLoginKeyUnavailable: string;
    roles: string;
    notes: string;
    status: string;
    active: string;
    inactive: string;
    superAdmin: string;
    rolePermissions: string;
    grantedPermissions: string;
    revokedPermissions: string;
    effectivePermissions: string;
    userColumn: string;
    configPermission: string;
    configPermissionEnabled: string;
    configPermissionPartial: string;
    configPermissionNone: string;
    lastLogin: string;
    neverLoggedIn: string;
    actions: string;
    adminOnlyTooltip: string;
    editUser: string;
    deleteUser: string;
    deleteRole: string;
    rotateUserKey: string;
    createUser: string;
    saveChanges: string;
    autoGenerate: string;
    customKey: string;
    cancelLabel: string;
    close: string;
    keyRotated: string;
    userCreated: string;
    userUpdated: string;
    userDeleted: string;
    roleDeleted: string;
    loadFailed: string;
    saveFailed: string;
    deleteFailed: string;
    deleteConfirmTitle: string;
    deleteUserTitle: string;
    deleteRoleTitle: string;
    deleteConfirmDescription: string;
    deleteConfirmRoleDescription: string;
    deleteConfirmAction: string;
    recentActivityTitle: string;
    recentActivityDesc: string;
    noAuditLogs: string;
    auditPageTitle: string;
    auditPageDesc: string;
    auditSearchPlaceholder: string;
    auditActorFilter: string;
    auditAllTargetTypes: string;
    auditAllResults: string;
    auditAllSensitivity: string;
    auditActor: string;
    auditAction: string;
    auditTarget: string;
    auditTargetType: string;
    auditTargetCode: string;
    auditTime: string;
    auditResult: string;
    auditDetails: string;
    auditUnknownActor: string;
    auditResultSuccess: string;
    auditResultFailed: string;
    sensitivity: string;
    sensitivityNormal: string;
    sensitivitySensitive: string;
    auditActionUserCreate: string;
    auditActionUserUpdate: string;
    auditActionUserDelete: string;
    auditActionUserRotateKey: string;
    auditActionRoleCreate: string;
    auditActionRoleUpdate: string;
    auditActionRoleDelete: string;
    auditActionOrganizationCreate: string;
    auditActionOrganizationUpdate: string;
    auditActionOrganizationDelete: string;
    auditActionResourceGovernanceUpdate: string;
    validationUserCodeRequired: string;
    validationUserCodePattern: string;
    validationUserCodeDuplicate: string;
    validationDisplayNameRequired: string;
    validationRoleRequired: string;
    validationRoleCodeDuplicate: string;
    validationAccessKeyDuplicate: string;
    validationRoleReadOnly: string;
    validationRoleAssignedUsers: string;
    validationLastAdminRequired: string;
    validationFormSubmitFailed: string;
    errorManageOrganizationsDenied: string;
    errorGrantPermissionsDenied: string;
    errorOrganizationOutsideBoundary: string;
    errorOrganizationOutsideScope: string;
    errorTargetOrganizationOutsideBoundary: string;
    errorTargetOrganizationOutsideScope: string;
    errorRoleAssignmentBoundary: string;
    errorPermissionGrantBoundary: string;
    errorDataScopeBoundary: string;
    errorUnknownOrganization: string;
    errorUnknownRoles: string;
    errorUnknownPermissions: string;
    errorPermissionsOverlap: string;
    errorUserPermissionsChanged: string;
    errorOrganizationCodeDuplicate: string;
    errorParentOrganizationNotFound: string;
    errorRootOrganizationParent: string;
    errorOrganizationParentRequired: string;
    errorOrganizationSelfParent: string;
    errorOrganizationDescendantParent: string;
    errorRootOrganizationDisable: string;
    errorOrganizationActiveChildren: string;
    errorOrganizationAssignedUsers: string;
    filterAllDataScopes: string;
    filterAllRoles: string;
    filterAllStatuses: string;
    filterAllConfigPermissions: string;
    filterAllSharePolicies: string;
    resetFilters: string;
    emptySelection: string;
    formHasError: string;
    formHasErrors: string;
    categoryBusiness: string;
    categoryFinance: string;
    categoryTax: string;
    categoryOps: string;
    categorySms: string;
    categoryBiz: string;
    categoryResources: string;
    categoryPlatform: string;
    categoryCollaboration: string;
    categoryRecruitment: string;
    categoryRecruitmentConfig: string;
    resourcesPageTitle: string;
    resourcesPageDesc: string;
    resourcePartialLoadFailed: string;
    resourcesSearchPlaceholder: string;
    resourceDomain: string;
    resourceDomainMail: string;
    resourceDomainSkill: string;
    resourceDomainModel: string;
    resourceName: string;
    sharePolicy: string;
    sharePolicyPrivate: string;
    sharePolicySharedReadonly: string;
    sharePolicySharedCopyable: string;
    sharePolicyPublicInGroup: string;
    resourceStatusDraft: string;
    updatedAt: string;
    viewDetails: string;
    editResourceGovernance: string;
    saveResourceGovernance: string;
    resourceGovernanceUpdated: string;
    resourceGovernanceUpdateFailed: string;
    allowSubOrgUse: string;
    allowCopy: string;
    resourceEnabled: string;
    resourceScopeLevel: string;
    resourceScopeOrg: string;
    resourceScopeOrgAndChildren: string;
    resourceScopeGroup: string;
    resourceScopeHelp: string;
    copyResource: string;
    copyResourceTitle: string;
    copyResourceDesc: string;
    copyResourceSubmit: string;
    copyResourceSuccess: string;
    copyResourceFailed: string;
    resourceCopyUnavailable: string;
    resourceCopyRequirement: string;
    targetOrganizationCode: string;
    targetOrganizationCodePlaceholder: string;
    resourcesEmptyTitle: string;
    resourcesEmptyDesc: string;
    resourceDetailTitle: string;
    resourceDetailDesc: string;
    resourceDetailEmpty: string;
    resourceDescription: string;
  };

  // Quick Actions
  quickActions: {
    title: string;
    recentUsed: string;
    quickEntry: string;
    browseAll: string;
    devTools: string;
    ocrTool: string;
    helpDocs: string;
  };

  // Help Page
  help: {
    title: string;
    docList: string;
    openInNewWindow: string;
    selectDoc: string;
    backButton: string;
  };

  // Confirm Dialog
  dialog: {
    logoutTitle: string;
    logoutMessage: string;
  };

  // DevTools
  devTools: {
    title: string;
    subtitle: string;
    common: string;
    advanced: string;
    nav: {
      json: string;
      timestamp: string;
      uuid: string;
      base64: string;
      url: string;
      jwt: string;
      hash: string;
      regex: string;
      decrypt: string;
    };
    json: {
      title: string;
      desc: string;
      input: string;
      output: string;
      placeholder: string;
      clear: string;
      minify: string;
      format: string;
      copySuccess: string;
    };
    timestamp: {
      title: string;
      desc: string;
      label: string;
      placeholder: string;
      convert: string;
      beijingTime: string;
      nowLabel: string;
      getCurrent: string;
      invalid: string;
      datetimeLabel: string;
      datetimePlaceholder: string;
      toTimestamp: string;
      timestampResult: string;
      invalidDatetime: string;
      toDatetime: string;
      seconds: string;
      milliseconds: string;
    };
    uuid: {
      title: string;
      desc: string;
      generate: string;
      copySuccess: string;
    };
    base64: {
      title: string;
      desc: string;
      placeholder: string;
      encode: string;
      decode: string;
      resultPlaceholder: string;
      encodeFail: string;
      decodeFail: string;
      invalidBase64: string;
    };
    url: {
      title: string;
      inputPlaceholder: string;
      encode: string;
      decode: string;
      resultPlaceholder: string;
      error: string;
    };
    jwt: {
      title: string;
      desc: string;
      tokenLabel: string;
      tokenPlaceholder: string;
      headerLabel: string;
      payloadLabel: string;
      invalidFormat: string;
      parseFail: string;
    };
    hash: {
      title: string;
      desc: string;
      inputLabel: string;
      placeholder: string;
    };
    regex: {
      title: string;
      patternPlaceholder: string;
      flagsPlaceholder: string;
      testBtn: string;
      testStringLabel: string;
      testStringPlaceholder: string;
      matchesLabel: string;
      noMatches: string;
      error: string;
    };
    decrypt: {
      title: string;
      desc: string;
      inputLabel: string;
      inputPlaceholder: string;
      keyLabel: string;
      keyPlaceholder: string;
      decryptBtn: string;
      outputLabel: string;
      outputPlaceholder: string;
      success: string;
      fail: string;
      copySuccess: string;
      emptyInput: string;
      emptyKey: string;
      wrongKey: string;
    };

  };

  // Business Scripts
  scripts: {
    delivery: {
      title: string;
      multiUserMode: string;
      subTitleLogin: string;
      subTitleProcess: string;
      exitLogin: string;
      login: {
        title: string;
        desc: string;
        envLabel: string;
        mobileLabel: string;
        mobilePlaceholder: string;
        mobileHint: string;
        submitBtn: string;
        submitting: string;
        brandFeature1: string;
        brandFeature2: string;
        brandFeature3: string;
      };
      process: {
        teamTitle: string;
        noTasks: string;
        refreshBtn: string;
        selectTask: string;
        statusRunning: string;
        noSelectTask: string;
        form: {
          title: string;
          titlePlaceholder: string;
          address: string;
          addressPlaceholder: string;
          desc: string;
          descPlaceholder: string;
          supplement: string;
          supplementPlaceholder: string;
          attachments: string;
          attachmentHint: string;
          imageHint: string;
          fileHint: string;
          supportedFormats: string;
          uploadImg: string;
          uploadFile: string;
          remove: string;
          uploadFailPrefix: string;
          submit: string;
          submitting: string;
        };
      };
      messages: {
        mobileInvalid: string;
        loginFailed: string;
        loginSuccess: string;
        noLogin: string;
        refreshSuccess: string;
        fileSizeLimit: string;
        picLimit: string;
        fileLimit: string;
        uploadSuccess: string;
        uploadFailed: string;
        waitUpload: string;
        deleteFailed: string;
        pathFailed: string;
        submitSuccess: string;
        submitFailed: string;
        requestError: string;
        minAttachment: string;
        required: string;
        processError: string;
        requestTimeout: string;
        networkError: string;
        serverError: string;
        uploadTimeout: string;
        uploadNetworkError: string;
        uploadServerError: string;
        uploadPayloadTooLarge: string;
        submitTimeout: string;
        submitNetworkError: string;
        submitServerError: string;
        batchProcessError: string;
        loggedOut: string;
      };
    };

    ocr: {
      title: string;
      subtitle: string;
      actions: {
        actionLabel: string;
        start: string;
        processing: string;
        abort: string;
        aborting: string;
        download: string;
        downloading: string;
        cancel: string; // Add cancel here if it's missing in type definition but used
      };
      status: {
        initializing: string;
        processing: string;
        completed: string;
        completedDesc: string;
        partial: string;
        partialDesc: string;
        remaining: string;
        waiting: string;
        progressLabel: string;
      };
      form: {
        dataSource: string;
        dataSourceDesc: string;
        excelLabel: string;
        excelPlaceholder: string;
        excelHint: string;
        imagesLabel: string;
        imagesHint: string;
        folderPlaceholder: string;
        folderHint: string;
        selectedFiles: string;
        totalSize: string;
        largeFileWarning: string;
      };
      mode: {
        label: string;
        excelFirst: string;
        excelFirstDesc: string;
        imagesFirst: string;
        imagesFirstDesc: string;
      };
      dialog: {
        backTitle: string;
        backContent: string;
        backConfirm: string;
        abortTitle: string;
        abortContent: string;
        abortConfirm: string;
      };
      messages: {
        selectExcel: string;
        selectFolder: string;
        success: string;
        fail: string;
        downloadForbidden: string;
        downloadFailed: string;
        resultMissing: string;
      };
      logs: {
        startUpload: string;
        uploading: string;
        uploadComplete: string;
        aborted: string;
        failed: string;
        aborting: string;
      };
    };
    settlement: {
      title: string;
      subtitle: string;
      back: string;
      status: {
        running: string;
        ready: string;
      };
      mode: {
        concurrent: string;
        sequential: string;
        label: string;
      };
      environment: {
        label: string;
        prod: string;
        beta: string;
      };
      config: {
        title: string;
        executionMode: string;
        selectMode: string;
        modes: {
          settlement: string;
          reissue: string;
          single: string;
        };
        concurrency: string;
        concurrencyPlaceholder: string;
        concurrencyHint: string;
        interval: string;
        intervalHint: string;
      };
      enterprise: {
        title: string;
        add: string;
        empty: string;
        emptyHint: string;
        item: string;
        remove: string;
        name: string;
        namePlaceholder: string;
        token: string;
        tokenPlaceholder: string;
        tenantId: string;
        tenantIdPlaceholder: string;
        taxId: string;
        taxIdPlaceholder: string;
        items1: string;
        items1Placeholder: string;
        items2: string;
        items2Placeholder: string;
        items3: string;
        items3Placeholder: string;
        items3Hint: string;
      };
      actions: {
        processing: string;
        stop: string;
        start: string;
        copyLogs: string;
        clearLogs: string;
      };
      logs: {
        title: string;
        waiting: string;
        copySuccess: string;
        copyFail: string;
        start: string;
        stopRequest: string;
        stopSuccess: string;
        abort: string;
        aborted: string;
        success: string;
        error: string;
        finished: string;
        unknownError: string;
      };
      messages: {
        selectMode: string;
        addEnterprise: string;
        incompleteInfo: string;
        missingItems1: string;
        missingItems2: string;
        missingItems3: string;
        invalidItems3: string;
        start: string;
        confirmBack: string;
        execSuccess: string;
      };
    };
    commission: {
      title: string;
      subtitle: string;
      back: string;
      status: {
        running: string;
        ready: string;
        apiMismatch: string;
      };
      params: {
        title: string;
        env: string;
        envPlaceholder: string;
        channelId: string;
        channelIdPlaceholder: string;
        start: string;
        loading: string;
      };
      logs: {
        title: string;
        waiting: string;
        autoFollow: string;
        paused: string;
        bottom: string;
        clear: string;
        start: string;
        success: string;
        error: string;
      };
      messages: {
        selectEnvAndChannelId: string;
        execSuccess: string;
      };
      kpi: {
        title: string;
        totalProfit: string;
        monthCommission: string;
        dailyCommission: string;
        profitStatus: string;
        totalPay: string;
        dailyPay: string;
        totalCount: string;
        matchRate: string;
        profitable: string;
        loss: string;
        countSuffix: string;
      };
      taxAnalysis: {
        title: string;
        searchPlaceholder: string;
        onlyMismatch: string;
        pageSize: string;
        empty: string;
        noData: string;
        totalPages: string;
        totalItems: string;
        prev: string;
        next: string;
      };
      table: {
        taxName: string;
        actualPay: string;
        payAmount: string;
        serviceFee: string;
        channelFee: string;
        apiCommission: string;
        difference: string;
        channelProfit: string;
        batchNo: string;
        settlementNo: string;
        month: string;
        history: string;
        actions: string;
        detail: string;
      };
      dialog: {
        title: string;
        copy: string;
        copySuccess: string;
        copyFail: string;
        fields: {
          taxName: string;
          taxId: string;
          entName: string;
          entId: string;
          actualPay: string;
          payAmount: string;
          serverFee: string;
          channelFee: string;
          apiCommission: string;
          difference: string;
          allowance: string;
          rawFee: string;
          channelProfit: string;
          rawProfit: string;
          batchNo: string;
          settlementNo: string;
          rateConfig: string;
          rateDetail: string;
          history: string;
          payTime: string;
          month: string;
          verifyStatus: string;
          matched: string;
          mismatched: string;
        };
      };
      enterpriseAnalysis: {
        title: string;
        empty: string;
        info: string;
        fields: {
          name: string;
          id: string;
          totalPay: string;
          totalCommission: string;
          totalCount: string;
          totalRecharge: string;
        };
        table: {
          month: string;
          monthPay: string;
          monthCommission: string;
          monthCount: string;
          monthRecharge: string;
        };
      };
    };
    balance: {
      title: string;
      subtitle: string;
      back: string;
      status: {
        querying: string;
        ready: string;
      };
      tabs: {
        single: string;
        batch: string;
      };
      actions: {
        startBatch: string;
      };
      params: {
        title: string;
        env: string;
        envPlaceholder: string;
        envProd: string;
        envTest: string;
        label: string;
        searchPlaceholder: string;
        query: string;
        querying: string;
        reset: string;
        export: string;
      };
      kpi: {
        queryCount: string;
        totalTax: string;
        errorTax: string;
        normalTax: string;
      };
      table: {
        title: string;
        pageSize: string;
        total: string;
        taxId: string;
        taxAddress: string;
        entName: string;
        deductions: string;
        recharges: string;
        refunds: string;
        expected: string;
        actual: string;
        diff: string;
        result: string;
        noDiff: string;
        correct: string;
        abnormal: string;
      };
      messages: {
        inputValidId: string;
        noData: string;
        success: string;
        verifySuccess: string;
        fail: string;
        reset: string;
        file: string;
        listFail: string;
        listUpdate: string;
      };
      empty: {
        noData: string;
        ready: string;
        instruction: string;
      };
    };
    taskAutomation: {
      title: string;
      subtitle: string;
      back: string;
      tabs: {
        upload: string;
        mode: string;
        task: string;
        results: string;
      };
      upload: {
        title: string;
        label: string;
        dragDrop: string;
        dragDropHint: string;
        supportTxt: string;
        manualTitle: string;
        manualLabel: string;
        manualPlaceholder: string;
        submitBtn: string;
        startLine: string;
        endLine: string;
        startPlaceholder: string;
        endPlaceholder: string;
        fetchBtn: string;
        fetching: string;
        clear: string;
        fileSelected: string;
        listTitle: string;
        listCount: string;
      };
      mode: {
        title: string;
        label: string;
        placeholder: string;
        options: {
          full: string;
          loginSign: string;
          loginDelivery: string;
          loginBalance: string;
        };
        desc: {
          full: string;
          loginSign: string;
          loginDelivery: string;
          loginBalance: string;
        };
      };
      execution: {
        envLabel: string;
        envPlaceholder: string;
        typeLabel: string;
        typePlaceholder: string;
        sequential: string;
        concurrent: string;
        concurrencyLabel: string;
        next: string;
      };
      task: {
        title: string;
        idLabel: string;
        idPlaceholder: string;
        start: string;
        running: string;
        status: string;
        ready: string;
        executing: string;
      };
      table: {
        phone: string;
        status: string;
        result: string;
        pending: string;
        success: string;
        failed: string;
      };
      messages: {
        fileRequired: string;
        invalidRange: string;
        parseSuccess: string;
        processSuccess: string;
        parseFail: string;
        inputValidPhone: string;
        taskInfoRequired: string;
        success: string;
        fail: string;
        download: string;
      };
    };
    batchSms: {
      title: string;
      subtitle: string;
      status: {
        sending: string;
        resending: string;
        loading: string;
        ready: string;
        processing: string;
      };
      tabs: {
        template: string;
        single: string;
        batch: string;
        resend: string;
        logs: string;
      };
      login: {
        button: string;
        loggedIn: string;
        title: string;
        description: string;
        secretLabel: string;
        secretPlaceholder: string;
        cancel: string;
        submit: string;
        envTest: string;
        envProd: string;
        toast: {
          invalidKey: string;
          apiMissing: string;
          success: string;
          fail: string;
          error: string;
          errorRequest: string;
          loginRequired: string;
        };
      };
      template: {
        configTitle: string;
        envLabel: string;
        envPlaceholder: string;
        envTest: string;
        envProd: string;
        timeoutLabel: string;
        fetchAll: string;
        fetchAllowed: string;
        viewCode: string;
        hideCode: string;
        updateConfig: string;
        listTitle: string;
        searchPlaceholder: string;
        empty: string;
        table: {
          code: string;
          name: string;
          status: string;
          allowed: string;
          restricted: string;
        };
        codeFormatTitle: string;
        copy: string;
        copied: string;
        copyHint: string;
      };
      single: {
        title: string;
        selectTemplate: string;
        selectPlaceholder: string;
        refresh: string;
        usePreset: string;
        paramsTitle: string;
        paramHint: string;
        noParams: string;
        addParam: string;
        paramName: string;
        paramValue: string;
        mobileList: string;
        mobilePlaceholder: string;
        mobileHint: string;
        send: string;
      };
      batch: {
        title: string;
        templateList: string;
        searchAllowed: string;
        noAllowed: string;
        selectAll: string;
        clearSelection: string;
        randomSend: string;
        randomHint: string;
        send: string;
        mobileList: string;
        mobilePlaceholder: string;
        usePreset: string;
      };
      resend: {
        title: string;
        typeLabel: string;
        mobileType: string;
        batchType: string;
        mobileLabel: string;
        mobilePlaceholder: string;
        mobileHint: string;
        taxIdLabel: string;
        taxIdPlaceholder: string;
        taxIdHint: string;
        batchNoLabel: string;
        batchNoPlaceholder: string;
        batchNoHint: string;
        requestId: string;
        submit: string;
        resultTitle: string;
        details: string;
      };
      results: {
        title: string;
        export: string;
        total: string;
        success: string;
        failure: string;
        table: {
          mobile: string;
          template: string;
          result: string;
          detail: string;
          view: string;
          hide: string;
        };
      };
      messages: {
        fetchSuccess: string;
        fetchFail: string;
        updateSuccess: string;
        updateFail: string;
        copySuccess: string;
        copyFail: string;
        mobileParse: string;
        mobileInvalid: string;
        selectTemplate: string;
        inputMobile: string;
        noValidMobile: string;
        sendSuccess: string;
        sendFail: string;
        resendSuccess: string;
        resendFail: string;
        noResult: string;
      };
      logs: {
        title: string;
        refresh: string;
        query: string;
        reset: string;
        export: string;
        filters: {
          mobile: string;
          mobilePlaceholder: string;
          sendStatus: string;
          receiveStatus: string;
          templateType: string;
          templateId: string;
          sendTime: string;
          all: string;
          success: string;
          failed: string;
          pending: string;
          types: {
            verification: string;
            notification: string;
            marketing: string;
          }
        };
        table: {
          id: string;
          mobile: string;
          templateCode: string;
          templateType: string;
          content: string;
          sendStatus: string;
          receiveStatus: string;
          sendTime: string;
          empty: string;
          unknown: string;
          success: string;
          failed: string;
          waiting: string;
          types: {
            verification: string;
            notification: string;
            marketing: string;
          }
        };
        pagination: {
          total: string;
          prev: string;
          next: string;
          page: string;
          size: string;
        }; toast: {
          refreshSuccess: string;
          fetchFail: string;
          fetchFailMsg: string;
        };
      };
    };
    taxReport: {
      title: string;
      back: string;
      environment: {
        label: string;
        placeholder: string;
        prod: string;
        test: string;
      };
      tabs: {
        query: string;
        generate: string;
        platform: string;
      };
      query: {
        title: string;
        description: string;
        yearMonth: string;
        amountType: {
          label: string;
          placeholder: string;
          payAmount: string;
          payAmountDesc: string;
          workerPayAmount: string;
          workerPayAmountDesc: string;
          billAmount: string;
          billAmountDesc: string;
        };
        fetch: string;
        fetching: string;
        enterprise: {
          label: string;
          selectAll: string;
          deselectAll: string;
          loading: string;
          empty: string;
          status: string;
          id: string;
        };
      };
      list: {
        title: string;
        resultSuffix: string;
        serviceFeeStatus: {
          label: string;
          all: string;
          success: string;
          failed: string;
        };
        totalAmount: string;
        amountBreakdown: string;
        summary: string;
        rowsPerPage: string;
      };
      table: {
        index: string;
        name: string;
        idCard: string;
        enterprise: string;
        taxLand: string;
        turnover: string;
        tax: string;
        serviceFeeStatus: string;
        taxStatus: string;
        noTaxRequired: string;
        noData: string;
      };
      dialog: {
        title: string;
        content: string;
        cancel: string;
        confirm: string;
        generating: string;
      };
      messages: {
        enterpriseUpdateSuccess: string;
        enterpriseUpdateFail: string;
        enterpriseError: string;
        yearMonthRequired: string;
        fetchSuccess: string;
        fetchFail: string;
        fetchError: string;
        noDataForReport: string;
        generating: string;
        generateSuccess: string;
        generateError: string;
        requestError: string;
        enterpriseErrorLog: string;
        fetchErrorLog: string;
        generateErrorLog: string;
        platformStartEndMonthRequired: string;
        platformFetchSuccess: string;
        platformFetchFail: string;
        platformFetchError: string;
        platformFetchErrorLog: string;
        platformNoDataForReport: string;
        platformGenerating: string;
        platformGenerateSuccess: string;
        platformGenerateError: string;
        platformGenerateErrorLog: string;
      };
      generate: {
        title: string;
        description: string;
        yearMonth: string;
        amountType: string;
        amountTypePlaceholder: string;
        amountTypes: {
          payAmount: string;
          payAmountDesc: string;
          workerPayAmount: string;
          workerPayAmountDesc: string;
          billAmount: string;
          billAmountDesc: string;
        };
        platformCompany: string;
        platformCompanyPlaceholder: string;
        creditCode: string;
        creditCodePlaceholder: string;
        preview: {
          title: string;
          yearMonth: string;
          enterprise: string;
          selected: string;
          noSelection: string;
          id: string;
          remove: string;
          clear: string;
        };
        download: string;
        instructions: {
          title: string;
          items: {
            time: string;
            location: string;
            history: string;
            sheets: string;
          };
        };
      };
      platform: {
        title: string;
        description: string;
        startMonth: string;
        endMonth: string;
        selectRangePlaceholder: string;
        selectStartHint: string;
        selectEndHint: string;
        clearRange: string;
        presets: {
          lastMonth: string;
          last3Months: string;
          last6Months: string;
          yearToDate: string;
        };
        platformCompany: string;
        platformCompanyPlaceholder: string;
        platformName: string;
        platformNamePlaceholder: string;
        creditCode: string;
        creditCodePlaceholder: string;
        taxId: string;
        taxIdPlaceholder: string;
        enterpriseSelect: string;
        fetch: string;
        fetching: string;
        download: string;
        generating: string;
        exportData: string;
        exporting: string;
        resultTitle: string;
        resultSuffix: string;
        totalLaborIncome: string;
        totalServiceFee: string;
        totalRecords: string;
        table: {
          index: string;
          name: string;
          idCard: string;
          enterprise: string;
          taxLand: string;
          turnover: string;
          tax: string;
          serviceFeeStatus: string;
          taxStatus: string;
          noTaxRequired: string;
          noData: string;
          laborIncome: string;
          serviceFee: string;
          tradeCount: string;
          miniAppId: string;
          mobile: string;
        };
        messages: {
          startEndMonthRequired: string;
          fetchSuccess: string;
          fetchFail: string;
          fetchError: string;
          noDataForReport: string;
          generating: string;
          generateSuccess: string;
          generateError: string;
          generateErrorLog: string;
        };
      };
    };
    taxCalculator: {
      title: string;
      description: string;
      status: {
        calculating: string;
        ready: string;
      };
      config: {
        title: string;
        description: string;
        useMock: string;
        mockTab: string;
        realTab: string;
        batchNo: string;
        batchNoPlaceholder: string;
        taxId: string;
        taxIdPlaceholder: string;
        realName: string;
        realNamePlaceholder: string;
        incomeType: string;
        incomeTypePlaceholder: string;
        incomeTypes: {
          labor: string;
          salary: string;
        };
        year: string;
        yearPlaceholder: string;
        yearHint: string;
        deduction: string;
        deductionPlaceholder: string;
        env: string;
        envPlaceholder: string;
        envs: {
          test: string;
          prod: string;
          local: string;
        };
        cityTaxRate: string;
        eduSurchargeRate: string;
        localEduSurchargeRate: string;
        salaryVatHint: string;
      };
      mock: {
        title: string;
        batchAmountPlaceholder: string;
        applyAll: string;
        addRecord: string;
        billAmount: string;
        months: string[];
      };
      actions: {
        reset: string;
        calculate: string;
        view: string;
        rowsPerPage: string;
        jump: string;
        close: string;
        noResult: string;
        page: string;
        back: string;
      };
      results: {
        title: string;
        export: string;
        total: string;
        headerTotal: string;
        footer: {
          taxOnlyTotal: string;
          vatTotal: string;
          surchargesTotal: string;
          otherTaxTotal: string;
          grandTotal: string;
          warningMsg: string;
          calcSteps: string;
        };
        messages: {
          limit12: string;
          invalidAmount: string;
          invalidId: string;
          ruleError: string;
          noMock: string;
          invalidDate: string;
          noMatch: string;
          success: string;
          fail: string;
          error: string;
          pageRange: string;
        };
        table: {
          yearMonth: string;
          deduction: string;
          specialDeduction: string;
          preTaxIncome: string;
          taxableIncome: string;
          accumulatedTax: string;
          taxRate: string;
          preTax: string;
          afterTax: string;
          monthlyTax: string;
          actualBurden: string;
          name: string;
          totalTax: string;
          vat: string;
          surcharges: string;
          totalTaxAndFees: string;
          otherTax: string;
          statisticsTotal: string;
        };
        fileName: string;
      };
    };
    settlementSim: {
      back: string;
      title: string;
      description: string;
      ready: string;
      executing: string;
      execute: string;
      environment: string;
      envTest: string;
      envProd: string;
      prodWarning: string;
      tabs: {
        title: string;
        batchUpdate: string;
        balanceUpdate: string;
        batchTaxWrite: string;
        balanceTaxWrite: string;
      };
      fields: {
        batchNo: string;
        balanceNo: string;
        batchStatus: string;
        workerStatus: string;
        year: string;
        month: string;
        writeTax: string;
        optional: string;
      };
      messages: {
        success: string;
        error: string;
      };
      resultTitle: string;
      resultStep1: string;
      resultStep2: string;
      resultAffected: string;
      resultTime: string;
      resultError: string;
    };
    paymentStats: {
      title: string;
      back: string;
      config: {
        title: string;
        env: string;
        envTest: string;
        envProd: string;
        filter: string;
        selected: string;
        placeholder: string;
        search: string;
        empty: string;
        selectAll: string;
        testEnterprise: string;
        excludeHint: string;
        calculate: string;
        calculating: string;
      };
      kpi: {
        totalSettlement: string;
        taxCount: string;
        basedOn: string;
        totalService: string;
        serviceDesc: string;
        totalTax: string;
      };
      charts: {
        monthlyTitle: string;
        noData: string;
        records: string;
        serviceFee: string;
        taxAmount: string;
        table: {
          enterprise: string;
          tax: string;
          amount: string;
          service: string;
          taxAmount: string;
        };
      };
      tables: {
        tax: {
          title: string;
          subtitle: string;
        };
        enterprise: {
          title: string;
          subtitle: string;
        };
        headers: {
          taxName: string;
          entName: string;
          uninvoiced: string;
          invoiced: string;
          ratio: string;
          total: string;
          service: string;
          taxAmount: string;
        };
        empty: {
          instruction: string;
          noData: string;
        };
      };
      messages: {
        fetchFail: string;
        selectRequired: string;
        calcSuccess: string;
        calcFail: string;
      };
    };
    bizSceneTask: {
      pageTitle: string;
      pageSubtitle: string;
      back: string;
      envLabel: string;
      envTest: string;
      envProd: string;
      envLocal: string;
      sceneSectionTitle: string;
      sceneSectionDesc: string;
      sceneListHeader: string;
      expand: string;
      collapse: string;
      sceneName: string;
      sceneNo: string;
      businessType: string;
      flexibleEmployment: string;
      continuousLabor: string;
      taskType: string;
      assign: string;
      grab: string;
      isExempt: string;
      noExemptDefault: string;
      yesExempt: string;
      sceneDesc: string;
      cancel: string;
      save: string;
      adding: string;
      addScene: string;
      addSuccess: string;
      requestId: string;
      createdScenes: string;
      taskSectionTitle: string;
      taskSectionDesc: string;
      selectEnterprise: string;
      tenantId: string;
      deptId: string;
      taxId: string;
      taskConfig: string;
      assignTask: string;
      grabTask: string;
      enterpriseDelivery: string;
      partnerDelivery: string;
      taskCount: string;
      addTask: string;
      addingTask: string;
      addSuccessTask: string;
      requestIdTask: string;
      createdCount: string;
      taskList: string;
      confirmTitle: string;
      confirmDesc: string;
      confirmCreate: string;
      cancelBtn: string;
      validationSelectEnterprise: string;
      addFail: string;
    };
  };


  // Language
  language: {
    zh: string;
    en: string;
    switchTo: string;
  };

  // Theme
  theme: {
    light: string;
    dark: string;
    system: string;
    toggle: string;
  };

  // Agent Chat
  agentChat: {
    attachmentTooLarge: string;
    attachmentExtractionFailed: string;
    title: string;
    subtitle: string;
    newChat: string;
    newConversation: string;
    prebuiltAssistants: string;
    add: string;
    conversationHistory: string;
    noConversations: string;
    welcomeTitle: string;
    welcomeDesc: string;
    startResumeScreening: string;
    startFreeChat: string;
    inputPlaceholder: string;
    resumeInputPlaceholder: string;
    addAssistantTitle: string;
    assistantIcon: string;
    assistantName: string;
    assistantNamePlaceholder: string;
    assistantDescription: string;
    assistantDescPlaceholder: string;
    systemPrompt: string;
    systemPromptPlaceholder: string;
    saveAssistant: string;
    deleteAssistant: string;
    assistantAdded: string;
    assistantDeleted: string;
    nameAndPromptRequired: string;
    navLabel: string;
  };

  // Recruitment
  recruitment: {
    // Organization
    searchOrganization: string;
    selectOrganization: string;
    noOrganizationMatch: string;
    organizationGroup: string;
    organizationSubGroup: string;
    organizationCompany: string;
    organizationDepartment: string;
    // Common Actions
    refresh: string;
    refreshing: string;
    candidateIdentity: {
      namePending: string;
    };
    candidateComparison: {
      title: string;
      subtitle: string;
      trayTitle: string;
      trayNeedMore: (count: number) => string;
      trayCanAdd: (count: number) => string;
      trayFull: string;
      selectedCount: (count: number) => string;
      selectionHint: string;
      importSelection: string;
      startComparison: string;
      startComparisonCount: (count: number) => string;
      comparisonCount: (count: number) => string;
      backToCandidates: string;
      clearSelection: string;
      addCandidate: string;
      removeCandidate: string;
      removeCandidateAria: (name: string) => string;
      compareCandidateAria: (name: string) => string;
      minimumRequired: string;
      maximumReached: string;
      samePositionRequired: string;
      assignedPositionRequired: string;
      selectedCandidateUnavailable: string;
      addedToTray: (count: number) => string;
      alreadyInTray: string;
      overflowSkipped: string;
      removedAndExited: string;
      loading: string;
      loadFailed: string;
      retry: string;
      refresh: string;
      refreshing: string;
      staleTitle: string;
      staleDescription: string;
      updatedLive: string;
      snapshotVersion: (version: string) => string;
      updatedAt: (value: string) => string;
      protocolUnavailable: string;
      strictBadge: string;
      limitedBadge: string;
      incompatibleBadge: string;
      strictTitle: string;
      strictDescription: string;
      strictNoRankingDescription: string;
      limitedTitle: string;
      limitedDescription: string;
      incompatibleTitle: string;
      incompatibleDescription: string;
      reasonsTitle: string;
      factsTitle: string;
      factsDescription: string;
      aiAssessmentTitle: string;
      manualScoreTitle: string;
      manualScoreNone: string;
      manualScorePartial: string;
      manualScoreComplete: string;
      dimensionsTitle: string;
      strengthsTitle: string;
      risksTitle: string;
      artifactStateTitle: string;
      warningsTitle: string;
      duplicateWarningTitle: string;
      duplicatePhone: string;
      duplicateEmail: string;
      duplicateBoth: string;
      duplicateGroup: (match: string, names: string) => string;
      keyDifferencesTitle: string;
      keyDifferencesDescription: string;
      noKeyDifferences: string;
      candidateName: string;
      status: string;
      city: string;
      education: string;
      experience: string;
      currentCompany: string;
      currentPosition: string;
      source: string;
      currentStage: string;
      aiScore: string;
      aiNormalizedScore: string;
      rawScore: (score: string, maxScore: string) => string;
      totalScoreHighest: string;
      totalScoreTiedHighest: string;
      manualScoreIndependent: string;
      manualScoreMissing: string;
      manualScoreValue: (value: string) => string;
      matchPercent: string;
      recommendation: string;
      suggestedStatus: string;
      manualOverrideScore: string;
      manualOverrideReason: string;
      artifactStrict: string;
      artifactLegacy: string;
      artifactProcessing: string;
      artifactMissing: string;
      artifactFailed: string;
      artifactInvalid: string;
      artifactStale: string;
      reasonArtifactMissing: string;
      reasonArtifactLegacy: string;
      reasonArtifactStale: string;
      reasonArtifactInvalid: string;
      reasonArtifactProcessing: string;
      reasonArtifactFailed: string;
      reasonProtocolMismatch: string;
      reasonDimensionMismatch: string;
      reasonScoreTotalMismatch: string;
      reasonAuditRequestHashMismatch: string;
      reasonPositionContextMismatch: string;
      reasonManualOverrideMixed: string;
      reasonPossibleDuplicateContact: string;
      reasonUnknown: string;
      coreDimension: string;
      coreDimensionsSection: string;
      otherDimensionsSection: string;
      totalScoresSection: string;
      comparisonDimension: string;
      viewDetails: string;
      highestScore: string;
      tiedHighestScore: string;
      differenceSpread: (value: string) => string;
      scoreValue: (score: string, maxScore: string) => string;
      maxScoreLabel: (value: string) => string;
      noData: string;
      unavailable: string;
      unknownCandidate: string;
      processingReconcile: string;
      readOnlyDecisionNote: string;
    };
    uploadResume: string;
    createPosition: string;
    newPosition: string;
    editPosition: string;
    generateJD: string;
    generateAILabel: string;
    aiGenerationNotes: string;
    aiGenerationNotesWithJD: string;
    aiGenerationNotesNoJD: string;
    aiGenerationNotesNoPosition: string;
    // Status
    enabled: string;
    disabled: string;
    enabling: string;
    saving: string;
    // Page Titles
    noPositions: string;
    noPositionsDesc: string;
    noJDVersions: string;
    noJDVersionsDesc: string;
    noCandidates: string;
    noCandidatesDesc: string;
    loadingMoreCandidates: string;
    allCandidatesLoaded: string;
    positionCandidates: string;
    viewInCandidatePage: string;
    positionCandidatesSearch: string;
    // Skill
    newSkill: string;
    aiGenerate: string;
    enable: string;
    disable: string;
    skillEnabled: string;
    skillDisabled: string;
    // Model
    newModel: string;
    newModelConfig: string;
    copyModel: string;
    enabledModels: string;
    currentTaskHint: string;
    // Mail
    refreshMailSettings: string;
    sendCurrentCandidate: string;
    newRecipient: string;
    newSender: string;
    noRecipientsAvailable: string;
    selectable: string;
    // Audit
    refreshTasks: string;
    expandFilters: string;
    collapseFilters: string;
    // Toast Messages
    dataRefreshed: string;
    positionDeletedRefreshFailed: string;
    mailConfigRefreshFailed: string;
    mailSentRefreshFailed: string;
    // Assistant
    assistantHint: string;
    assistantContextHint: string;
    // JD Dialog
    autoParseAfterUpload: string;
    enableAutoSendHint: string;
    // Organization Scope
    currentViewingOrg: string;
    currentOrgScope: string;
    currentDeptScope: string;
    allVisibleDepts: string;
    orgCompany: string;
    landingOrg: string;
    selectLandingOrg: string;
    openAIAssistant: string;
    manageSettings: string;
    skillManagement: string;
    loadingWorkspace: string;
    // Position Dialog
    newPositionTitle: string;
    editPositionTitle: string;
    // Position Form
    positionName: string;
    department: string;
    location: string;
    employmentType: string;
    salaryRange: string;
    headcount: string;
    positionStatus: string;
    tags: string;
    tagsPlaceholder: string;
    keyRequirements: string;
    bonusPoints: string;
    screeningConfig: string;
    autoScreenOnUpload: string;
    autoScreenHint: string;
    autoAdvanceOnScreening: string;
    autoMailAfterScreening: string;
    autoMailHint: string;
    enableAutoPush: string;
    usePositionRecipients: string;
    useGlobalRecipients: string;
    useGlobalHint: string;
    positionRecipients: string;
    ccRecipients: string;
    bccRecipients: string;
    noRecipientsHint: string;
    noCcHint: string;
    noBccHint: string;
    bindSkills: string;
    bindSkillsHint: string;
    positionSummary: string;
    savePosition: string;
    // Resume Upload Dialog
    uploadResumeTitle: string;
    uploadResumeDesc: string;
    linkPosition: string;
    selectFiles: string;
    selectedFiles: string;
    uploading: string;
    uploadProgress: string;
    uploadRecovery: {
        resultsTitle: string;
        summary: string;
        retryFailed: string;
        unknownHint: string;
        uploaded: string;
        skipped_duplicate: string;
        failed: string;
        unknown: string;
        notStarted: string;
        processing: string;
        dispatchPending: string;
        contextChanged: string;
    };
    // Delete Dialogs
    confirmDeletePosition: string;
    confirmDeletePositionDesc: string;
    confirmDeleteCandidate: string;
    confirmDeleteCandidateDesc: string;
    confirmBatchDeleteCandidate: string;
    confirmBatchDeleteCandidateDesc: string;
    confirmDeleteResume: string;
    confirmDeleteResumeDesc: string;
    resumeDeleteHint: string;
    // Skill Editor
    skillEditorTitle: string;
    skillName: string;
    skillRoleName: string;
    skillRoleBackground: string;
    skillDescription: string;
    skillContent: string;
    skillTags: string;
    skillPriority: string;
    skillPriorityCore: string;
    skillPrioritySecondary: string;
    skillPriorityAuxiliary: string;
    skillPriorityBonus: string;
    skillMaxScore: string;
    skillHardRequirement: string;
    skillHardRequirementHint: string;
    skillDimensionName: string;
    skillDimensionPlaceholder: string;
    skillEvaluationFocus: string;
    skillEvaluationPlaceholder: string;
    skillUnnamed: string;
    skillSave: string;
    skillUpdate: string;
    skillCreate: string;
    skillHardRules: string;
    skillHardRulesPlaceholder: string;
    skillJudgmentRules: string;
    skillJudgmentRulesPlaceholder: string;
    skillBasicInfo: string;
    skillDimensions: string;
    skillAdvancedMode: string;
    skillAiMode: string;
    skillStructuredMode: string;
    // Skill Editor Table
    skillDimensionIndex: string;
    skillDimensionFullScore: string;
    skillDimensionPriority: string;
    skillDimensionHard: string;
    skillDimensionActions: string;
    skillDimensionsCount: string;
    skillDimensionsEmpty: string;
    skillDimensionsAdd: string;
    skillTabsStructured: string;
    skillTabsAdvanced: string;
    skillTabsAi: string;
    skillAdvancedHint: string;
    skillAiEmptyHint: string;
    // Common form fields
    required: string;
    placeholderRoleName: string;
    placeholderSkillName: string;
    placeholderRoleBackground: string;
    placeholderDescription: string;
    placeholderTags: string;
    placeholderTagsHint: string;
    // Task type labels
    taskTypeJd: string;
    taskTypeScreening: string;
    taskTypeInterview: string;
    taskTypeHint: string;
    // Total score badge
    totalScore: string;
    // Validation errors
    validationPositionNameRequired: string;
    validationPositionNameTooLong: string;
    validationSkillNameRequired: string;
    validationSkillNameTooLong: string;
    validationSkillContentRequired: string;
    validationSkillSortInvalid: string;
    validationSkillSceneRequired: string;
    // Toast messages
    positionCreated: string;
    positionUpdated: string;
    positionDeleted: string;
    positionDeleteFailed: string;
    positionSaveFailed: string;
    jdGenerated: string;
    jdGeneratedFallback: string;
    uploadCancelled: string;
    resumeOpenFailed: string;
    // Resume mail
    resumeMailSent: string;
    resumeMailResent: string;
    resumeMailFailed: string;
    resumeMailSentHint: string;
    selectResumeFirst: string;
    selectRecipientFirst: string;
    resumeMailNoCandidateSelected: string;
    // Candidate
    candidates: string;
    candidateDeleted: string;
    candidateDeleteFailed: string;
    batchCandidatesDeleted: string;
    batchCandidatesDeleteFailed: string;
    resumeDeleted: string;
    resumeDeleteFailed: string;
    currentResume: string;
    // Batch update
    batchUpdatePosition: string;
    batchUpdatePositionSuccess: string;
    batchUpdatePositionFailed: string;
  };
}
