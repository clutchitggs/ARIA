from setuptools import setup, find_packages

setup(
    name="aria-sdk",
    version="0.1.0",
    description="ARIA — Free health audit for AI systems. Detects agent loops, cascade failures, and wasted spend.",
    packages=find_packages(),
    python_requires=">=3.8",
    install_requires=[],  # no hard deps — anthropic/openai are optional
    extras_require={
        "anthropic": ["anthropic>=0.30.0"],
        "openai": ["openai>=1.0.0"],
        "all": ["anthropic>=0.30.0", "openai>=1.0.0"],
    },
)
