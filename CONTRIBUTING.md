# Contributing to Meesho Ecosystem

First off, thank you for considering contributing to the Meesho Ecosystem! 🎉

The following is a set of guidelines for contributing to the Meesho Ecosystem and its packages. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Process](#development-process)
- [Style Guidelines](#style-guidelines)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Community](#community)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to [support@example.com](mailto:support@example.com).

### Our Standards

- Using welcoming and inclusive language
- Being respectful of differing viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

## Getting Started

1. **Fork the Repository**
   ```bash
   # Click the 'Fork' button on GitHub
   git clone https://github.com/your-username/meesho-ecosystem.git
   cd meesho-ecosystem
   ```

2. **Set Up Development Environment**
   ```bash
   # Install dependencies
   npm install

   # Set up environment variables
   cp .env.example .env

   # Run tests to verify setup
   npm test
   ```

3. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

**Bug Report Template:**
```markdown
## Description
A clear and concise description of what the bug is.

## Steps To Reproduce
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

## Expected Behavior
What you expected to happen.

## Actual Behavior
What actually happened.

## Screenshots
If applicable, add screenshots.

## Environment
- OS: [e.g. macOS, Windows, Linux]
- Node Version: [e.g. 16.14.0]
- Browser: [if applicable]
```

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

**Enhancement Template:**
```markdown
## Summary
Brief description of the enhancement.

## Motivation
Why is this enhancement needed?

## Detailed Description
Detailed explanation of the enhancement.

## Alternatives Considered
What alternatives have you considered?
```

### Your First Code Contribution

Unsure where to begin? You can start by looking through these issues:
- `good first issue` - issues which should only require a few lines of code
- `help wanted` - issues which need extra attention
- `documentation` - issues related to documentation improvements

### Pull Requests

1. **Follow the style guidelines**
2. **Include tests** for new functionality
3. **Update documentation** as needed
4. **Write clear commit messages**
5. **Keep PRs focused** - one feature/fix per PR

## Development Process

### Project Structure

```
meesho-ecosystem/
├── services/           # Microservices
├── shared/            # Shared utilities
├── tests/             # Test suites
└── docs/              # Documentation
```

### Running Services Locally

```bash
# Start all services
npm run dev

# Start specific service
npm run dev:seller-service

# Run with debugging
npm run debug
```

### Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- --grep "Seller Service"

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### Building

```bash
# Build all services
npm run build

# Build specific service
npm run build:seller-service

# Production build
npm run build:production
```

## Style Guidelines

### TypeScript Style Guide

We use ESLint and Prettier for code formatting. Run these before committing:

```bash
# Lint code
npm run lint

# Fix lint issues
npm run lint:fix

# Format code
npm run format
```

**Key Guidelines:**
- Use TypeScript strict mode
- Prefer `const` over `let`
- Use async/await over promises
- Write self-documenting code
- Add JSDoc comments for public APIs

### Example Code Style

```typescript
/**
 * Calculates the Seller Quality Score
 * @param metrics - The seller metrics
 * @returns The calculated SQS value
 */
export async function calculateSQS(
  metrics: SellerMetrics
): Promise<number> {
  const weights = {
    productQuality: 0.4,
    customerSatisfaction: 0.3,
    operationalEfficiency: 0.3,
  };

  const score =
    metrics.productQuality * weights.productQuality +
    metrics.customerSatisfaction * weights.customerSatisfaction +
    metrics.operationalEfficiency * weights.operationalEfficiency;

  return Math.round(score * 100);
}
```

### API Design Guidelines

- Use RESTful conventions
- Version your APIs (`/api/v1/`)
- Return consistent response formats
- Include proper error handling
- Document with OpenAPI/Swagger

## Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

### Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Test additions or corrections
- `chore`: Maintenance tasks
- `ci`: CI/CD changes

### Examples
```bash
feat(seller-service): add bulk import functionality

fix(review-service): correct ML model threshold

docs(api): update seller endpoints documentation

refactor(shared): optimize redis connection pool

test(loyalty): add integration tests for rewards
```

## Pull Request Process

1. **Update Documentation**
   - Update README.md with details of changes
   - Add/update API documentation
   - Update environment variables in .env.example

2. **Ensure Tests Pass**
   ```bash
   npm test
   npm run lint
   ```

3. **Update Version**
   - Follow semantic versioning
   - Update package.json version
   - Update CHANGELOG.md

4. **PR Title Format**
   Use the same format as commit messages:
   ```
   feat(seller-service): add verification webhook
   ```

5. **PR Description Template**
   ```markdown
   ## Description
   Brief description of changes

   ## Type of Change
   - [ ] Bug fix
   - [ ] New feature
   - [ ] Breaking change
   - [ ] Documentation update

   ## Testing
   - [ ] Unit tests pass
   - [ ] Integration tests pass
   - [ ] Manual testing completed

   ## Checklist
   - [ ] Code follows style guidelines
   - [ ] Self-review completed
   - [ ] Documentation updated
   - [ ] Tests added/updated
   - [ ] No breaking changes
   ```

6. **Review Process**
   - At least one approval required
   - All CI checks must pass
   - No merge conflicts
   - Up-to-date with main branch

## Community

### Getting Help

- **Discord**: [Join our community](https://discord.gg/example)
- **Stack Overflow**: Tag questions with `meesho-ecosystem`
- **GitHub Discussions**: For general discussions
- **Email**: support@example.com

### Recognition

Contributors who make significant contributions will be:
- Added to the CONTRIBUTORS.md file
- Mentioned in release notes
- Given special badges in our Discord community

### Roadmap

Check our [project board](https://github.com/yourusername/meesho-ecosystem/projects) for upcoming features and priorities.

## Development Tips

### Debugging

```bash
# Enable debug logs
DEBUG=meesho:* npm run dev

# Debug specific service
DEBUG=meesho:seller-service npm run dev:seller-service

# Use VS Code debugger
npm run debug
```

### Performance Testing

```bash
# Run load tests
npm run test:load

# Profile performance
npm run profile
```

### Database Migrations

```bash
# Create new migration
npm run migrate:create -- --name add_seller_tier

# Run migrations
npm run migrate:up

# Rollback
npm run migrate:down
```

## Release Process

1. Create release branch
2. Update version numbers
3. Update CHANGELOG.md
4. Create PR to main
5. After merge, tag release
6. Deploy to production

## Questions?

Feel free to open an issue or reach out on Discord. We're here to help!

---

Thank you for contributing to the Meesho Ecosystem! 🚀