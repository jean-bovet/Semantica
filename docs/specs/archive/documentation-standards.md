# Documentation Standards

**Status**: ✅ Implemented  
**Created**: 2025-08-24  
**Purpose**: Establish consistent documentation naming and organization conventions

## File Naming Conventions

### ALL CAPS Files
Reserved for well-known, standard files that are universally recognized:

- `README.md` - Project overview and getting started
- `CLAUDE.md` - AI assistant context and instructions
- `LICENSE.md` - Software license
- `CONTRIBUTING.md` - Contribution guidelines
- `CHANGELOG.md` - Version history
- `CODE_OF_CONDUCT.md` - Community standards
- `SECURITY.md` - Security policies

### lowercase-with-hyphens Files
All other documentation files should use lowercase with hyphens:

- Technical specifications: `architecture.md`, `memory-solution.md`
- Planning documents: `parser-version-tracking.md`, `testing-strategy.md`
- Analysis documents: `search-quality-analysis.md`, `multilingual-search-strategy.md`
- Guides and tutorials: `troubleshooting.md`, `getting-started.md`

## Directory Structure

```
FSS/
├── README.md                    # Main project overview (ALL CAPS)
├── CLAUDE.md                    # AI assistant context (ALL CAPS)
├── docs/                        # Implementation analysis
│   ├── README.md               # Directory index (ALL CAPS)
│   └── *.md                    # All other files (lowercase)
├── specs/                       # Technical specifications
│   ├── README.md               # Directory index (ALL CAPS)
│   └── *.md                    # All other files (lowercase)
└── planning/                    # Future enhancements
    ├── README.md               # Directory index (ALL CAPS)
    └── *.md                    # All other files (lowercase)
```

## Documentation Categories

### `/specs/` - Technical Specifications
- Finalized technical designs
- Implementation details
- Architecture decisions
- System requirements
- Database schemas

### `/docs/` - Implementation Analysis
- Current system analysis
- Performance metrics
- Quality assessments
- Implementation guides
- Best practices

### `/planning/` - Future Enhancements
- Feature proposals
- Enhancement plans
- Research documents
- POC designs
- Future roadmap

## Writing Guidelines

### File Headers
Every documentation file should start with:
```markdown
# Title of Document

**Status**: 📋 Planned / 🚧 In Progress / ✅ Implemented  
**Priority**: High / Medium / Low (if applicable)
**Created**: YYYY-MM-DD
**Updated**: YYYY-MM-DD (if modified)
```

### Cross-References
When linking between documents:
- Use relative paths: `../specs/architecture.md`
- Include brief description: `[Architecture](../specs/architecture.md) - System design`
- Verify links after renaming files

### Consistency Rules
1. **Case**: Follow the naming conventions strictly
2. **Hyphens**: Use hyphens, not underscores (except for ALL CAPS files)
3. **Extensions**: Always use `.md` for markdown files
4. **Abbreviations**: Spell out unless universally known (API, URL, etc.)

## Migration Checklist

When renaming files to follow these standards:

1. ✅ Use `git mv` to preserve history
2. ✅ Update all internal references
3. ✅ Update README files that link to the document
4. ✅ Search for references in code comments
5. ✅ Test all links still work
6. ✅ Update any CI/CD scripts that reference the files

## Examples

### ✅ Correct Naming
- `README.md` (standard file)
- `CLAUDE.md` (standard file)
- `architecture.md` (technical spec)
- `search-quality-analysis.md` (analysis doc)
- `parser-version-tracking.md` (planning doc)

### ❌ Incorrect Naming
- `ARCHITECTURE.md` (should be lowercase)
- `readme.md` (should be ALL CAPS)
- `search_quality_analysis.md` (should use hyphens)
- `SearchQualityAnalysis.md` (should be lowercase)

## Enforcement

These standards should be:
1. Referenced in CLAUDE.md for AI assistant awareness
2. Documented in contributing guidelines
3. Checked during code reviews
4. Applied to all new documentation
5. Retroactively applied to existing files when modified

## Recent Changes

### 2025-08-24 Normalization
Renamed the following files in `/specs/` to follow conventions:
- `ARCHITECTURE.md` → `architecture.md`
- `MEMORY-SOLUTION.md` → `memory-solution.md`  
- `TROUBLESHOOTING.md` → `troubleshooting.md`