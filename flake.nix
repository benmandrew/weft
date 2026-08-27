{
  description = "chain — connection graphs for the word chain game";

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
          name = "chain";

          packages = [
            (pythonEnv pkgs)
            pkgs.nixfmt
            pkgs.ruff
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

            # nltk downloads the WordNet corpus into ~/nltk_data and refuses to
            # start without it. pkgs.wordnet is the Princeton 3.0 distribution
            # and its dict/ holds the same WNdb files nltk parses, so a symlink
            # under a search path nltk already scans removes the download and
            # pins the corpus version alongside everything else. It has to be
            # the directory layout rather than a WordNetCorpusReader pointed at
            # the store path: the reader falls back to the global lazy corpus
            # when it resolves sense keys, and that fallback ignores the root.
            export NLTK_DATA="$PWD/.nltk_data"
            mkdir -p "$NLTK_DATA/corpora"
            ln -sfn "${pkgs.wordnet}/dict" "$NLTK_DATA/corpora/wordnet"
          '';
        };
      });
    };
}
