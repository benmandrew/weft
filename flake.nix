{
  description = "WordNet as circular diagrams: the hypernym taxonomy, the word chain game and the letter graph under it";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      pythonEnv =
        pkgs:
        pkgs.python3.withPackages (ps: [
          ps.nltk
          ps.networkx
          ps.matplotlib
          ps.mypy
          ps.numpy
          ps.pyvis
          ps.wordfreq
        ]);
    in
    {
      # `nix fmt` formats this file.
      formatter = forAllSystems (pkgs: pkgs.nixfmt);

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          name = "weft";

          packages = [
            (pythonEnv pkgs)
            pkgs.nixfmt
            pkgs.ruff
            # `taplo check` validates weft.toml against the schema that
            # taplo.toml names, which is the same check an editor runs.
            pkgs.taplo
            # `biome lint` and `biome format` over web/ and tools/. It is one
            # binary with the rules built in, like ruff and taplo above, so the
            # JavaScript checks need no node_modules and no lockfile.
            pkgs.biome
            # For `make web`, `make table` and `make web-dist`. `node --check`
            # skips the early-error pass a browser runs, so check_web.mjs loads
            # each module in web/ instead, which needs a JavaScript runtime.
            pkgs.nodejs
            # `make types` reads the JSDoc annotations in web/ under
            # tsconfig.json. Nothing is emitted and no .ts file exists: the
            # types are comments, so the module served is the module edited.
            pkgs.typescript
          ];

          env = {
            PYTHONPYCACHEPREFIX = ".cache/pycache";
          };

          shellHook = ''
            # direnv runs this hook on every load, and a nested `nix develop`
            # runs it again, so appending unconditionally stacks duplicates.
            case ":''${PYTHONPATH:-}:" in
              *":$PWD/src:"*) ;;
              *) export PYTHONPATH="$PWD/src''${PYTHONPATH:+:$PYTHONPATH}" ;;
            esac

            # pkgs.wordnet is Princeton WordNet 3.0, whose dict/ holds the WNdb
            # files nltk parses, so a symlink under NLTK_DATA replaces nltk's
            # download and pins the corpus. It has to be the directory layout:
            # a WordNetCorpusReader on the store path falls back to the global
            # lazy corpus for sense keys, ignoring its root.
            export NLTK_DATA="$PWD/.nltk_data"
            mkdir -p "$NLTK_DATA/corpora"
            ln -sfn "${pkgs.wordnet}/dict" "$NLTK_DATA/corpora/wordnet"
          '';
        };
      });
    };
}
