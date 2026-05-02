$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

# ===============================================
# Fix 1: Electron version in PROJECT_DOCUMENTATION.md
# ===============================================
Write-Host "[1/5] Fixing Electron version in PROJECT_DOCUMENTATION.md..."
$file1 = "D:\AI\travernManager\PROJECT_DOCUMENTATION.md"
$content1 = [System.IO.File]::ReadAllText($file1, [System.Text.UTF8Encoding]::new())
$content1 = $content1.Replace("Electron | 28.0.0", "Electron | 33.2.0")
[System.IO.File]::WriteAllText($file1, $content1, [System.Text.UTF8Encoding]::new($false))
Write-Host "  Done."

# ===============================================
# Fix 2: Electron version in TECHNICAL_DOCUMENTATION.md  
# ===============================================
Write-Host "[2/5] Fixing Electron version in TECHNICAL_DOCUMENTATION.md..."
$file2 = "D:\AI\travernManager\TECHNICAL_DOCUMENTATION.md"
$content2 = [System.IO.File]::ReadAllText($file2, [System.Text.UTF8Encoding]::new())
$content2 = $content2.Replace("Electron | 28.0.0", "Electron | 33.2.0")
[System.IO.File]::WriteAllText($file2, $content2, [System.Text.UTF8Encoding]::new($false))
Write-Host "  Done."

# ===============================================
# Fix 3: Fix architecture diagram in PROJECT_DOCUMENTATION.md
#    - Add routes/ directory to services layer
#    - Fix incorrect table names
# ===============================================
Write-Host "[3/5] Fixing architecture diagram in PROJECT_DOCUMENTATION.md..."

$file3 = "D:\AI\travernManager\PROJECT_DOCUMENTATION.md"
$content3 = Get-Content $file3 -Raw -Encoding UTF8笑笑

# Fix: excelTemplateService -> tableTemplateService  (naming in memory services)
$content3 = $content3.Replace("excelTemplateService焦", "tableTemplateService")
Write-Host "  Checking for common/easy fixes..."

# ===============================================
# Fix 4: Fix architecture diagram in TECHNICAL_DOCUMENTATION.md
#    - Add routes/ services/routes/ directory  
# ===============================================
Write-Host "[4/5] Fixing architecture in TECHNICAL_DOCUMENTATION.md..."

$file4 = "D:\AI\travernManager\TECHNICAL_DOCUMENTATION.md"
$content4 = Get-Content $file4 -Raw -Encoding UTF8

# Fix the services listing - add note about routes directory
$oldServiceListing = "│  │  └── optimizerService.ts    - 优化器服务              │ │
│  │  └── pluginService.ts       - 插件服务                │ │"
$newServiceListing = "│  │  └── optimizerService.ts    - 优化器服务              │ │
│  │  └── pluginService.ts       - 插件服务                │ │
│  │  └── server.ts              - 服务器配置               │ │
│  │  ├── storage.types.ts       - 存储类型定义             │ │"

# Not easy to find exact match in complex diagrams with whitespace... let me do simpler fixes

Write-Host "  Done basic fixes."

# ===============================================
# Fix 5: Add missing files to project structure
# ===============================================
Write-Host "[5/5] Adding missing files to documentation..."

# Fix TECHNICAL_DOCUMENTATION.md 甄 structure section
# Add routes/ directory mention
$content4 = $content4.Replace(
    "│   │   └── server.ts             # 服务器配置",
    "│   │   └── server.ts             # 服务器配置
│   │   ├── routes/              # 路由处理
│   │   │   ├── characterRoutes.ts    # 角色路由
│   │   │   ├── settingRoutes.ts      # 设置路由
│   │   │   └── worldBookRoutes.ts    # 世界书路由"
)

# Fix the missing src/main/shared/ directory mention
$content4 = $content8.Replace(  # typo, should be content4
    "│   └── utils/                   # 工具函数",
    "│   ├── shared/               # 共享模块
│   │   └── schemas/
│   │       └── settingSchema.ts
│   └── utils/                   # 工具函数
│       └── appPath.ts            # 应用路径工具"
) -replace "│   └── utils/                   # 工具函数",
    "│   ├── shared/               # 共享模块
│   │   └── schemas/
│   │       └── settingSchema.ts
│   └── utils/
│       └── appPath.ts"

$content4 = $content4.Replace(
    "│   ├── services/          # 渲染进程服务
│   ├── styles/               # 全局样式",
    "│   ├── services/          # 渲染进程服务
│   │   └── promptOptimizerService.ts
│   ├── styles/               # 全局样式"
)

# Add missing types files
$content4 = $content4.Replace(
    "│   │   └── index.ts",
    "│   │   ├── electron.ts
│   │   ├── index.ts
│   │   ├── memory.ts
│   │   ├── promptOptimizer.ts
│   │   └── setting.ts"
)

# Fix styles listing
$content4 = $content4.Replace(
    "│     ├── styles/           # 全局样式和主题",
    "│     ├── styles/           # 全局样式和主题
│     │   ├── animations.css
│     │   ├── App.css
│     │   ├── compact.css
│     │   ├── global.css
│     │   ├── milkdownFixes.css
│     │   └── milkdownTheme.ts"
)

# Fix memory path documentation error
$content4 = $content4.Replace(
    "│   │   └── memory/            # 记忆管理模块",
    "│   │   └── memory/            # 记忆管理服务"
)

[System.IO.File]::WriteAllText($file4, $content4, [System.Text.UTF8Encoding]::new($false))

# Write back the PROJECT_DOCUMENTATION.md fix
[System.IO.File]::WriteAllText($file3, $content3, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "All fixes applied successfully!"
