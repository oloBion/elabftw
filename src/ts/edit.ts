/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import { getEntity, notif, updateCatStat, escapeRegExp, notifError, reloadElement } from './misc';
import { getTinymceBaseConfig, quickSave } from './tinymce';
import { EntityType, Target, Upload, Model, Action } from './interfaces';
import { DateTime } from 'luxon';
import './doodle';
import tinymce from 'tinymce/tinymce';
import { getEditor } from './Editor.class';
import type { DropzoneFile } from 'dropzone';
import $ from 'jquery';
import i18next from 'i18next';
import EntityClass from './Entity.class';
import { Api } from './Apiv2.class';
import { ChemDoodle } from '@deltablot/chemdoodle-web-mini/dist/chemdoodle.min.js';
import { Uploader } from './uploader';

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('info')) {
    return;
  }

  // holds info about the page through data attributes
  const about = document.getElementById('info').dataset;

  // only run in edit mode
  if (about.page !== 'edit') {
    return;
  }

  const entity = getEntity();
  const EntityC = new EntityClass(entity.type);
  const ApiC = new Api();

  // Which editor are we using? md or tiny
  const editor = getEditor();
  editor.init();

  // initialize the file uploader
  const uploader = new Uploader();
  const dropZone = uploader.init();

  ////////////////
  // DATA RECOVERY

  // check if there is some local data with this id to recover
  if ((localStorage.getItem('id') == String(entity.id)) && (localStorage.getItem('type') == entity.type)) {
    const bodyRecovery = $('<div></div>', {
      class : 'alert alert-warning',
      id: 'recoveryDiv',
      html: 'Recovery data found (saved on ' + localStorage.getItem('date') + '). It was probably saved because your session timed out and it could not be saved in the database. Do you want to recover it?<br><button type="button" class="btn btn-primary recover-yes">YES</button> <button type="button" class="button btn btn-danger recover-no">NO</button><br><br>Here is what it looks like: ' + localStorage.getItem('body'),
    });
    $('#main_section').before(bodyRecovery);
  }

  // RECOVER YES
  $(document).on('click', '.recover-yes', function() {
    EntityC.update(entity.id, Target.Body, localStorage.getItem('body')).then(() => {
      editor.replaceContent(localStorage.getItem('body'));
      localStorage.clear();
      document.getElementById('recoveryDiv').remove();
    });
  });

  // RECOVER NO
  $(document).on('click', '.recover-no', function() {
    localStorage.clear();
    document.getElementById('recoveryDiv').remove();
  });

  // END DATA RECOVERY
  ////////////////////

  // GET MOL FILES
  function getListFromMolFiles(): void {
    const mols = [];
    ApiC.getJson(`${entity.type}/${entity.id}/${Model.Upload}`).then(json => {
      for (const upload of json as Array<Upload>) {
        const extension = upload.real_name.split('.').pop();
        // unfortunately, loading .rxn files here doesn't work as it expects json or mol only
        if (['mol', 'chemjson'].includes(extension)) {
          mols.push([upload.real_name, upload.long_name]);
        }
      }
      if (mols.length === 0) {
        notif({res: false, msg: 'No mol files found.'});
        return;
      }
      let listHtml = '<ul class="text-left">';
      mols.forEach(function(mol: [string, string], index: number) {
        listHtml += '<li style="color:#29aeb9" class="clickable loadableMolLink" data-target="app/download.php?f=' + mols[index][1] + '">' + mols[index][0] + '</li>';
      });
      $('.getMolButton').text('Refresh list');
      $('.getMolDiv').html(listHtml + '</ul>');
    });
  }

  $(document).on('click', '.getMolButton', function() {
    getListFromMolFiles();
  });

  // Load the content of a mol file from the list in the mol editor
  $(document).on('click', '.loadableMolLink', function() {
    $.get($(this).data('target')).done(function(molContent) {
      // a .chemjson file will be an object but we want a string
      if (typeof molContent === 'object') {
        molContent = JSON.stringify(molContent);
      }
      $('#sketcher_open_text').val(molContent);
    });
  });
  // END GET MOL FILES

  // Shared function to UPDATE ENTITY BODY via save shortcut and/or save button
  function updateEntityBody(el?: HTMLElement): void {
    EntityC.update(entity.id, Target.Body, editor.getContent()).then(() => {
      if (editor.type === 'tiny') {
        // set the editor as non dirty so we can navigate out without a warning to clear
        tinymce.activeEditor.setDirty(false);
      }
    }).then(() => {
      if (el && el.matches('[data-redirect="view"]')) {
        window.location.replace('?mode=view&id=' + entity.id);
      }
    });
  }

  // DRAW THE MOLECULE SKETCHER
  // documentation: https://web.chemdoodle.com/tutorial/2d-structure-canvases/sketcher-canvas#options
  const sketcher = new ChemDoodle.SketcherCanvas('sketcher', 750, 300, {
    oneMolecule: false,
  });

  // Add click listener and do action based on which element is clicked
  document.querySelector('.real-container').addEventListener('click', event => {
    const el = (event.target as HTMLElement);
    // UPDATE ENTITY BODY
    if (el.matches('[data-action="update-entity-body"]')) {
      updateEntityBody(el);

    // SWITCH EDITOR
    } else if (el.matches('[data-action="switch-editor"]')) {
      EntityC.update(entity.id, Target.ContentType, editor.switch() === 'tiny' ? '1' : '2');

    // GET NEXT CUSTOM ID
    } else if (el.matches('[data-action="get-next-custom-id"]')) {
      // fetch the category from the current value of select, as it might be different from the one on page load
      const category = (document.getElementById('category_select') as HTMLSelectElement).value;
      if (category === '0') {
        notifError(new Error(i18next.t('error-no-category')));
        return;
      }
      const inputEl = document.getElementById('custom_id_input') as HTMLInputElement;
      inputEl.classList.remove('is-invalid');
      // lock the button
      const button = el as HTMLButtonElement;
      button.disabled = true;
      // make sure the current id is null or it will increment this one
      EntityC.update(entity.id, Target.Customid, null).then(() => {
        // get the entity with highest custom_id
        return ApiC.getJson(`${el.dataset.endpoint}/?cat=${category}&order=customid&limit=1&sort=desc`);
      }).then(json => {
        const nextId = json[0].custom_id + 1;
        inputEl.value = nextId;
        return EntityC.update(entity.id, Target.Customid, nextId);
      }).finally(() => {
        // unlock the button
        button.disabled = false;
      });

    // CLICK the NOW button of a time or date extra field
    } else if (el.matches('[data-action="update-to-now"]')) {
      const input = el.closest('.input-group').querySelector('input');
      // use Luxon lib here
      const now = DateTime.local();
      // date format
      let format = 'yyyy-MM-dd';
      if (input.type === 'time') {
        format = 'HH:mm';
      }
      if (input.type === 'datetime-local') {
        /* eslint-disable-next-line quotes */
        format = "yyyy-MM-dd'T'HH:mm";
      }
      input.value = now.toFormat(format);
      // trigger change event so it is saved
      input.dispatchEvent(new Event('change'));

    // SAVE CHEM CANVAS AS FILE: chemjson or png
    } else if (el.matches('[data-action="save-chem-as-file"]')) {
      const realName = prompt(i18next.t('request-filename'));
      if (realName === null || realName === '') {
        return;
      }
      let content: string;
      switch (el.dataset.filetype) {
      case 'chemjson':
        content = JSON.stringify(new ChemDoodle.io.JSONInterpreter().contentTo(sketcher.molecules, sketcher.shapes));
        break;
      case 'png':
        // note: this is the same as ChemDoodle.io.png.string(sketcher)
        content = (document.getElementById('sketcher') as HTMLCanvasElement).toDataURL();
        break;
      case 'rxn':
        content = new ChemDoodle.io.RXNInterpreter().write(sketcher.molecules, sketcher.shapes);
        break;
      }

      const params = {
        'action': Action.CreateFromString,
        'file_type': el.dataset.filetype,
        'real_name': realName,
        'content': content,
      };
      ApiC.post(`${entity.type}/${entity.id}/${Model.Upload}`, params).then(() => reloadElement('uploadsDiv'));

    // ANNOTATE IMAGE
    } else if (el.matches('[data-action="annotate-image"]')) {
      // show doodle canvas
      const doodleDiv = document.getElementById('doodleDiv');
      doodleDiv.removeAttribute('hidden');
      doodleDiv.scrollIntoView();
      // adjust caret icon
      const doodleDivIcon = document.getElementById('doodleDivIcon');
      doodleDivIcon.classList.remove('fa-caret-right');
      doodleDivIcon.classList.add('fa-caret-down');

      const context: CanvasRenderingContext2D = (document.getElementById('doodleCanvas') as HTMLCanvasElement).getContext('2d');
      const img = new Image();
      // set src attribute to image path
      img.addEventListener('load', function() {
        // make canvas bigger than image
        context.canvas.width = (this as HTMLImageElement).width * 2;
        context.canvas.height = (this as HTMLImageElement).height * 2;
        // add image to canvas
        context.drawImage(img, (this as HTMLImageElement).width / 2, (this as HTMLImageElement).height / 2);
      });
      img.src = `app/download.php?storage=${el.dataset.storage}&f=${el.dataset.path}`;

    // IMPORT BODY OF LINKED ITEM INTO EDITOR
    } else if (el.matches('[data-action="import-link-body"]')) {
      // this is in this file and not in steps-links-edit because here `editor`
      // exists and is reachable
      ApiC.getJson(`${el.dataset.endpoint}/${el.dataset.target}`).then(json => {
        editor.setContent(json.body);
      });

    // IMPORT STEP INTO BODY
    } else if (el.matches('[data-action="import-step-body"]')) {
      ApiC.getJson(`${entity.type}/${entity.id}/${Model.Step}/${el.dataset.stepid}`).then(json => {
        let content = `<a href='?mode=view&id=${entity.id}&highlightstep=${el.dataset.stepid}#step_view_${el.dataset.stepid}'>${json.body}</a>`;
        // markdown
        if (editor.type === 'md') {
          content = `[${json.body}](?mode=view&id=${entity.id}&highlightstep=${el.dataset.stepid}#step_view_${el.dataset.stepid})`;
        }
        return editor.setContent(content);
      });

    // INSERT IMAGE AT CURSOR POSITION IN TEXT
    } else if (el.matches('[data-action="insert-image-in-body"]')) {
      // link to the image
      const url = `app/download.php?name=${el.dataset.name}&f=${el.dataset.link}&storage=${el.dataset.storage}`;
      // switch for markdown or tinymce editor
      let content: string;
      if (editor.type === 'md') {
        content = '\n![image](' + url + ')\n';
      } else if (editor.type === 'tiny') {
        content = '<img src="' + url + '" />';
      }
      editor.setContent(content);

    // ADD CONTENT OF PLAIN TEXT FILES AT CURSOR POSITION IN TEXT
    } else if (el.matches('[data-action="insert-plain-text"]')) {
      fetch(`app/download.php?storage=${el.dataset.storage}&f=${el.dataset.path}`).then(response => {
        return response.text();
      }).then(fileContent => {
        const specialChars = {
          '<': '&lt;',
          '>': '&gt;',
        };

        // wrap in pre element to retain whitespace, html encode '<' and '>'
        editor.setContent('<pre>' + fileContent.replace(/[<>]/g, char => specialChars[char]) + '</pre>');
      });
    }
  });

  // CATEGORY SELECT
  $(document).on('change', '.catstatSelect', function() {
    updateCatStat($(this).data('target'), entity, String($(this).val()));
  });

  // TITLE STUFF
  const titleInput = document.getElementById('title_input') as HTMLInputElement;
  // add the title in the page name (see #324)
  document.title = titleInput.value + ' - eLabFTW';

  // If the title is 'Untitled', clear it on focus
  titleInput.addEventListener('focus', event => {
    const el = event.target as HTMLInputElement;
    if (el.value === i18next.t('entity-default-title')) {
      el.value = '';
    }
  });

  titleInput.addEventListener('blur', () => {
    if (titleInput.value !== titleInput.defaultValue) {
      const content = titleInput.value;
      titleInput.defaultValue = content;
      EntityC.update(entity.id, Target.Title, content);
      // update the page's title
      document.title = content + ' - eLabFTW';
    }
  });

  // no tinymce stuff when md editor is selected
  if (editor.type === 'tiny') {
    // Object to hold control data for selected image
    const tinymceEditImage = {
      selected: false,
      uploadId: 0,
      filename: 'unknown.png',
      reset: function(): void {
        this.selected = false;
        this.uploadId = 0;
        this.filename = 'unknown.png';
      },
    };

    const tinyConfig = getTinymceBaseConfig('edit');

    const imagesUploadHandler = (blobInfo): Promise<string> => new Promise((resolve, reject) => {
      // Edgecase for editing an image using tinymce ImageTools
      // Check if it was selected. This is set by an event hook below
      if (tinymceEditImage.selected === true) {
        // Note: confirm will trigger the SelectionChange event hook below again
        if (confirm(i18next.t('replace-edited-file'))) {
          const formData = new FormData();
          const newfilecontent = new File(
            [blobInfo.blob()],
            tinymceEditImage.filename,
            { lastModified: new Date().getTime(), type: blobInfo.blob().type },
          );
          formData.set('file', newfilecontent);
          // prevent the browser from redirecting us
          formData.set('extraParam', 'noRedirect');
          // because the upload id is set this will replace the file directly
          fetch(`api/v2/${entity.type}/${entity.id}/${Model.Upload}/${tinymceEditImage.uploadId}`, {
            method: 'POST',
            body: formData,
          }).then(resp => {
            const location = resp.headers.get('location').split('/');
            const newId = location[location.length -1];
            // fetch info about the newly created upload
            return ApiC.getJson(`${entity.type}/${entity.id}/${Model.Upload}/${newId}`).then(json => {
              resolve(`app/download.php?f=${json.long_name}&storage=${json.storage}`);
              // save here because using the old real_name will not return anything from the db (status is archived now)
              updateEntityBody();
              reloadElement('uploadsDiv');
            });
          });
        } else {
          // Revert changes if confirm is cancelled
          // ToDo: several times undo, e.g. if user rotated twice 90° but does not confirm the change
          tinymce.activeEditor.undoManager.undo();
          reject('Action cancelled');
        }
      // If the blob has no filename, ask for one. (Firefox edgecase: Embedded image in Data URL)
      } else if (typeof blobInfo.blob().name === 'undefined') {
        const filename = prompt('Enter filename with extension e.g. .jpeg');
        if (typeof filename !== 'undefined' && filename !== null) {
          const file = new File([blobInfo.blob()], filename, { lastModified: new Date().getTime(), type: blobInfo.blob().type }) as DropzoneFile;
          dropZone.addFile(file);
          uploader.tinyImageSuccess = resolve;
        } else {
          // Just disregard the edit if the name prompt is cancelled
          tinymce.activeEditor.undoManager.undo();
          reject('Action cancelled');
        }
      } else {
        dropZone.addFile(blobInfo.blob());
        uploader.tinyImageSuccess = resolve;
      }
    });

    const tinyConfigForEdit = {
      images_upload_handler: imagesUploadHandler,
      // use undocumented callback function to asynchronously get the templates
      // see https://github.com/tinymce/tinymce/issues/5637#issuecomment-624982699
      templates: (callback): void => {
        ApiC.getJson(`${EntityType.Template}`).then(json => {
          const res = [];
          json.forEach(tpl => {
            res.push({'title': tpl.title, 'description': '', 'content': tpl.body});
          });
          callback(res);
        });
      },
      // use a custom function for the save button in toolbar
      save_onsavecallback: (): void => quickSave(),
    };

    tinymce.init(Object.assign(tinyConfig, tinyConfigForEdit));
    // Hook into the blur event - Finalize potential changes to images if user clicks outside of editor
    tinymce.activeEditor.on('blur', () => {
      // this will trigger the images_upload_handler event hook defined further above
      tinymce.activeEditor.uploadImages();
    });
    // Hook into the SelectionChange event - This is to make sure we reset our control variable correctly
    tinymce.activeEditor.on('SelectionChange', () => {
      // Check if the user has selected an image
      if (tinymce.activeEditor.selection.getNode().tagName === 'IMG') {
        // Save all the details needed for replacing upload
        // Then check for and get those details when you are handling file uploads
        const selectedImage = (tinymce.activeEditor.selection.getNode() as HTMLImageElement);
        const searchParams = new URL(selectedImage.src).searchParams;
        // Get all the uploads from that entity
        ApiC.getJson(`${entity.type}/${entity.id}/${Model.Upload}`).then(json => {
          // Now find the one corresponding to the image selected in the body
          const upload = json.find(upload => upload.long_name === searchParams.get('f'));
          tinymceEditImage.selected = true;
          // Get id and filename (real_name) from this
          // this allows us to know which corresponding upload is selected so we can replace it if needed (after a crop for instance)
          tinymceEditImage.uploadId = upload.id;
          tinymceEditImage.filename = upload.real_name;
        });
      } else if (tinymceEditImage.selected === true) {
        // delay reset a bit so that images_upload_handler gets called first and can finish
        setTimeout(() => {
          tinymceEditImage.reset();
        }, 50);
      }
    });
  }

  // REPLACE UPLOADED FILE
  // this should be in uploads but there is no good way so far to interact with the two editors there
  document.getElementById('filesdiv').addEventListener('submit', event => {
    const el = event.target as HTMLElement;
    if (el.matches('[data-action="replace-uploaded-file"]')) {
      event.preventDefault();

      // we can identify an image by the src attribute in this context
      const searchPrefixSrc = 'src="app/download.php?f=';
      const searchPrefixMd = '![image](app/download.php?f=';
      const formElement = el as HTMLFormElement;
      const editorCurrentContent = editor.getContent();
      const formData = new FormData(formElement);
      // prevent the browser from redirecting us
      formData.set('extraParam', 'noRedirect');
      fetch(`api/v2/${entity.type}/${entity.id}/${Model.Upload}/${el.dataset.uploadid}`, {
        method: 'POST',
        body: formData,
      }).then(resp => {
        reloadElement('uploadsDiv');
        // return early if longName is not found in body
        if ((editorCurrentContent.indexOf(searchPrefixSrc + formElement.dataset.longName) === -1)
          && (editorCurrentContent.indexOf(searchPrefixMd + formElement.dataset.longName) === -1)
        ) {
          return true;
        }
        // now replace all occurrence of the old file in the body with the long_name of the new file
        const location = resp.headers.get('location').split('/');
        const newId = location[location.length -1];
        // fetch info about the newly created upload
        ApiC.getJson(`${entity.type}/${entity.id}/${Model.Upload}/${newId}`).then(json => {
          // use regExp in replace to find all occurrence
          // images are identified by 'src="app/download.php?f=' (html) and '![image](app/download.php?f=' (md)
          // '.', '?', '[' and '(' need to be escaped in js regex
          const editorNewContent = editorCurrentContent.replace(
            new RegExp(escapeRegExp(searchPrefixSrc + formElement.dataset.longName), 'g'),
            searchPrefixSrc + json.long_name,
          ).replace(
            new RegExp(escapeRegExp(searchPrefixMd + formElement.dataset.longName), 'g'),
            searchPrefixMd + json.long_name,
          );
          editor.replaceContent(editorNewContent);

          // status of previous file is archived now
          // save because using the old file will not return an id from the db
          updateEntityBody();
        });
      });
    }
  });
});
