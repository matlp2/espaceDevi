 
/* AVEC SERVEUR LOCAL
function post(operation_name, data_to_convert_to_json = '', url_extension = '') {
	let formData = new FormData()
	formData.append(operation_name, JSON.stringify(data_to_convert_to_json))
	return fetch(
		'http://127.0.0.1:8080',
		{
			method: "POST",
			body: formData,
			headers: { 'Accept': 'application/json' },
		}
	)
}
function fetch_get({url_extension}) {
	url_extension ??= ''
	return fetch(
		'http://127.0.0.1:8080/'+url_extension,
		{
			method: "GET",
			headers: { 'Accept': 'application/json' },
		}
	)
}
function fech_delete({url_extension, operation_name, json}) {
	let formData = new FormData()
	formData.append(operation_name, JSON.stringify(json))
	return fetch(
		'http://127.0.0.1:8080',
		{
			method: "DELETE",
			body: formData,
			headers: {
				//"Content-Type": "text/plain"
				'Accept': 'application/json',
			},
		}
	)
	.then(()=>{
		update_liste_des_csv()
	})
}
*/




function fetch_on_backend_replacement({http_method, url_extension, operation_name, json}) {

	url_extension ??= ''

	console.log('fetch_on_backend_replacement', {http_method, url_extension, operation_name, json})


	if(http_method == 'GET' && url_extension == 'all_csv') {
		return persist
	}
	else if (http_method == 'POST') {

		switch(operation_name) {

			case 'set':
				for(const set_action of json) {

					const [path, new_value] = set_action

					console.log('set', {path, new_value})
					let obj = persist
					console.log(obj)
					for(const [i, key] of path.entries()){
						if(i === path.length-1) {// key === path.at(-1) ne marche pas car on peut avoir 0 === 0 !!!
							obj[path.at(-1)] = new_value
						}else{
							console.log(obj,'[',key,']')
							obj = obj[key]
							console.log(obj)
							
						}
						
					}
				}
				break


			case 'add_element_to_list':
				{
					const [path, value_to_add] = json

					console.log('add_element_to_list', {path, value_to_add})
					let obj = persist
	
					for(const key of path){
						obj = obj[key]
					}
	
					obj.push(value_to_add)
				}
				break


			case 'remove_element_from_list':
				{
					const [path, value_to_remove] = json

					console.log('remove_element_from_list', {path, value_to_remove})
					let obj = persist
	
					for(const key of path){
						obj = obj[key]
					}

					const index = obj.indexOf(value_to_remove);
					if (index > -1) obj.splice(index, 1);
				}
				break

			case 'add_query':
				{
					const index_of_table = json

					persist.elms[index_of_table].aj_request('count')
				}
				break

			case 'upload_file':
				{
					persist.aj_csv({name: json.filename, txt: json.txt})
				}
				break

			case 'add_column':
				{
					const [path, column_name] = json
					const [index_elm, index_request] = path

					//persist.elms[index_elm].requests[index_request].columns.push(column_name)

					persist.elms[index_elm].requests[index_request].aj_column(column_name)

				}
				break

			case 'remove_column':
				{
					const [path, column_name] = json
					const [index_elm, index_request] = path

					/*columns = persist.elms[index_elm].requests[index_request].columns
					const index = columns.indexOf(column_name)
					if (index > -1) columns.splice(index, 1)*/


					persist.elms[index_elm].requests[index_request].ej_column(column_name)

				}
				break

			case 'start_tumult_session':
				{
					run_session()
				}
				break

			case 'open_in_file_explorer':
				{
					open_file(json)
				}
				break

			case 'open_result_folder':
				{
					download_all_result_folder()
				}
				break
			
			case 'see_3D':
				{
					generate_pie_html(json)
				}
				break
				
		}
	} else if(http_method == 'DELETE') {
		switch(operation_name) {
			case 'delete_query':
				{
					const [index_of_table, index_of_query] = json

					console.log('delete_query', {index_of_table, index_of_query})

					persist.elms[index_of_table].requests.splice(index_of_query, 1)
				}
				break

			case 'index':
				{
					const index_of_table = json

					persist.elms.splice(index_of_table, 1)
				}
				break
		}

	}

	return {}
}





function post(operation_name, json = '', url_extension = '') {
	
	json_response = fetch_on_backend_replacement({http_method:'POST',operation_name, json, url_extension})


	return new Promise((resolve, reject) => {
		resolve({json:() => json_response})
	})
}

function fetch_get({url_extension}){

	json_response = fetch_on_backend_replacement({http_method:'GET', url_extension})

	return new Promise((resolve, reject) => {
		resolve({json:() => json_response})
	})
}


function fetch_delete({url_extension, operation_name, json}) {
	
	fjson_response = fetch_on_backend_replacement({http_method:'DELETE',url_extension, operation_name, json})

	return new Promise((resolve, reject) => {
		resolve({json:() => json_response})
	})
}